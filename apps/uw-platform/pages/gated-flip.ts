import { and, eq, sql } from 'drizzle-orm';
import type { ErrorReason, Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Transaction } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { lockedPage, snapshot, toPage, type PageRefusal } from './store.ts';

export type GatedFlip = {
  readonly pageId: string;
  readonly type: 'measure' | 'dashboard';
  readonly expectedVersion: number;
};

type Source = { readonly traceId: string; readonly requestId: string | null; readonly at: Date };

function refused(reason: ErrorReason, detail: PageRefusal['detail'] = {}): PageRefusal {
  return { ok: false, reason, detail };
}

export async function flipGatedPageIn(
  tx: Transaction,
  actor: Principal,
  flip: GatedFlip,
  source: Source,
): Promise<{ readonly ok: true; readonly page: Page } | PageRefusal> {
  if (actor.kind !== 'person') return refused('not_permitted');
  const stored = await lockedPage(tx, actor, flip.pageId, source.at);
  if (stored?.type !== flip.type) return refused('page_not_found', { pageId: flip.pageId });
  if (!can(actor, 'write', { kind: 'area', area: stored.jdArea }, source.at)) {
    return refused('not_permitted');
  }
  if (stored.status !== 'suggested') return refused('not_permitted', { why: 'not_suggested' });
  const [row] = await tx
    .update(pages)
    .set({ status: 'active', version: sql`${pages.version} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(pages.id, flip.pageId),
        eq(pages.version, flip.expectedVersion),
        eq(pages.status, 'suggested'),
      ),
    )
    .returning();
  if (row === undefined) return refused('stale_version', { pageId: flip.pageId });
  await snapshot(tx, row, actor, { traceId: source.traceId, requestId: source.requestId });
  return { ok: true, page: toPage(row) };
}
