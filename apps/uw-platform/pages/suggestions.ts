import { and, asc, eq, sql } from 'drizzle-orm';
import type { ErrorReason, Page, UpdatePageCommand } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor, Transaction } from '@uw/db/client';
import { pageSuggestionSets } from '@uw/db/schema';
import { embedsItself, resolveBody } from './links.ts';
import { readPage, type PageRefusal, type PageResult } from './store.ts';

type SetRow = typeof pageSuggestionSets.$inferSelect;

type Done = PageResult | PageRefusal;

export type PendingSuggestion = {
  readonly id: string;
  readonly proposedBy: string;
  readonly proposedAt: Date;
  readonly baseVersion: number;
};

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

function moved(stored: Page, full: UpdatePageCommand): readonly string[] {
  return [
    ...(full.slug === stored.slug ? [] : ['slug']),
    ...(full.parentId === stored.parentId ? [] : ['parentId']),
  ];
}

export async function proposeIn(
  tx: Transaction,
  actor: Principal,
  stored: Page,
  full: UpdatePageCommand,
  at: Date,
): Promise<Done> {
  const fields = moved(stored, full);
  if (fields.length > 0) return refused('malformed_command', { fields });
  const bodyMd = await resolveBody(tx, actor, { bodyMd: full.bodyMd, area: stored.jdArea }, at);
  if (await embedsItself(tx, stored.id, bodyMd)) return refused('embed_cycle');
  const change = {
    baseVersion: stored.version,
    title: full.title,
    frontmatter: full.frontmatter,
    bodyMd,
    proposedAt: at,
  };
  const mine = and(
    eq(pageSuggestionSets.pageId, stored.id),
    eq(pageSuggestionSets.proposedBy, actor.identity),
    eq(pageSuggestionSets.status, 'pending'),
  );
  const [open] = await tx.select().from(pageSuggestionSets).where(mine).for('update');
  if (open !== undefined) {
    await tx
      .update(pageSuggestionSets)
      .set({ ...change, revision: sql`${pageSuggestionSets.revision} + 1` })
      .where(eq(pageSuggestionSets.id, open.id));
    return { ok: true, page: stored, suggestionId: open.id };
  }
  const id = crypto.randomUUID();
  const row = { id, pageId: stored.id, proposedBy: actor.identity, status: 'pending', ...change };
  await tx.insert(pageSuggestionSets).values(row);
  return { ok: true, page: stored, suggestionId: id };
}

export async function pendingSuggestions(
  db: Executor,
  actor: Principal,
  page: Page,
  at: Date,
): Promise<readonly PendingSuggestion[]> {
  if (!can(actor, 'read', { kind: 'area', area: page.jdArea }, at)) return [];
  return db
    .select({
      id: pageSuggestionSets.id,
      proposedBy: pageSuggestionSets.proposedBy,
      proposedAt: pageSuggestionSets.proposedAt,
      baseVersion: pageSuggestionSets.baseVersion,
    })
    .from(pageSuggestionSets)
    .where(and(eq(pageSuggestionSets.pageId, page.id), eq(pageSuggestionSets.status, 'pending')))
    .orderBy(asc(pageSuggestionSets.proposedAt), asc(pageSuggestionSets.id));
}

export async function suggestionFor(
  db: Executor,
  actor: Principal,
  suggestionId: string,
  at: Date,
): Promise<{ readonly set: SetRow; readonly page: Page } | null> {
  const [set] = await db
    .select()
    .from(pageSuggestionSets)
    .where(eq(pageSuggestionSets.id, suggestionId));
  const page = set === undefined ? null : await readPage(db, actor, set.pageId, at);
  return set === undefined || page === null ? null : { set, page };
}
