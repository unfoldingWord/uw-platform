import { and, eq, sql } from 'drizzle-orm';
import type { ConfirmPageCommand, ErrorReason } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { lockedPage, snapshot, toPage, type PageRefusal, type PageResult } from './store.ts';

type Confirmation = {
  readonly actor: Principal;
  readonly command: ConfirmPageCommand;
  readonly traceId: string;
  readonly at: Date;
};

const CONFIRMABLE: ReadonlySet<string> = new Set(['learning', 'skill']);

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

async function confirmIn(
  tx: Transaction,
  confirmation: Confirmation,
): Promise<PageResult | PageRefusal> {
  const { actor, command, traceId, at } = confirmation;
  const stored = await lockedPage(tx, actor, command.pageId, at);
  if (stored === null) return refused('page_not_found', { pageId: command.pageId });
  if (stored.type === 'persona')
    return refused('not_permitted', { why: 'persona_needs_activation' });
  if (!CONFIRMABLE.has(stored.type))
    return refused('malformed_command', { why: 'not_confirmable' });
  if (!can(actor, 'write', { kind: 'area', area: stored.jdArea }, at))
    return refused('not_permitted');
  if (stored.status !== 'suggested') return refused('not_permitted', { why: 'not_suggested' });
  const [row] = await tx
    .update(pages)
    .set({ status: 'active', version: sql`${pages.version} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(pages.id, command.pageId),
        eq(pages.version, command.expectedVersion),
        eq(pages.status, 'suggested'),
      ),
    )
    .returning();
  if (row === undefined) return refused('stale_version', { pageId: command.pageId });
  await snapshot(tx, row, actor, traceId);
  return { ok: true, page: toPage(row) };
}

export async function confirmPage(
  db: Database,
  actor: Principal,
  command: ConfirmPageCommand,
  traceId: string,
  at: Date,
): Promise<PageResult | PageRefusal> {
  if (actor.kind !== 'person') return refused('not_permitted');
  return db.transaction((tx) => confirmIn(tx, { actor, command, traceId, at }));
}
