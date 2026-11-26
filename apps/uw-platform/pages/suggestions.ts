import { and, asc, eq } from 'drizzle-orm';
import type { Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageSuggestionSets } from '@uw/db/schema';
import { readPage } from './store.ts';

type SetRow = typeof pageSuggestionSets.$inferSelect;

export type PendingSuggestion = {
  readonly id: string;
  readonly proposedBy: string;
  readonly proposedAt: Date;
  readonly baseVersion: number;
};

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
