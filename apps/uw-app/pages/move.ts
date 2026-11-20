import { and, eq, sql } from 'drizzle-orm';
import { areaOfCategory, type ErrorReason, type MovePageCommand } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import { pageFiles, pages } from '@uw/db/schema';
import { replayOf } from './replay.ts';
import {
  lockedPage,
  pageConflict,
  parentRefusal,
  snapshot,
  toPage,
  type PageRefusal,
  type PageResult,
} from './store.ts';

const MOVABLE = 'knowledge';

type Move = {
  readonly actor: Principal;
  readonly command: MovePageCommand;
  readonly traceId: string;
  readonly at: Date;
};

function refused(reason: ErrorReason): PageResult {
  return { ok: false, reason };
}

function refiled(frontmatter: Readonly<Record<string, unknown>>, category: string) {
  if (frontmatter['jd_category'] === category) return { ...frontmatter };
  return { ...frontmatter, jd_category: category, jd_id: null };
}

async function moveInTransaction(tx: Transaction, move: Move): Promise<PageResult | PageRefusal> {
  const { actor, command, at } = move;
  await tx.execute(advisoryLock(advisoryLocks.pageReparenting));
  const stored = await lockedPage(tx, actor, command.pageId, at);
  if (!stored) return refused('page_not_found');
  if (stored.type !== MOVABLE) return refused('invalid_frontmatter');
  const target = areaOfCategory(command.category);
  const mayWrite = [stored.jdArea, target].every((area) =>
    can(actor, 'write', { kind: 'area', area }, at),
  );
  if (!mayWrite) return refused('not_permitted');
  const blocked = await parentRefusal(tx, actor, command, at);
  if (blocked !== null) return refused(blocked);
  const [row] = await tx
    .update(pages)
    .set({
      jdArea: target,
      parentId: command.parentId,
      frontmatter: refiled(stored.frontmatter, command.category),
      version: command.expectedVersion + 1,
      updatedAt: sql`now()`,
    })
    .where(and(eq(pages.id, command.pageId), eq(pages.version, command.expectedVersion)))
    .returning();
  if (!row) return refused('stale_version');
  await tx.update(pageFiles).set({ jdArea: target }).where(eq(pageFiles.pageId, row.id));
  await snapshot(tx, row, actor, { traceId: move.traceId, requestId: command.requestId });
  return { ok: true, page: toPage(row) };
}

export async function movePage(
  db: Database,
  actor: Principal,
  command: MovePageCommand,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  const replayed = await replayOf(db, actor, command.requestId);
  if (replayed !== null) return { ok: true, page: replayed };
  try {
    return await db.transaction((tx) => moveInTransaction(tx, { actor, command, traceId, at }));
  } catch (error) {
    return pageConflict(error);
  }
}
