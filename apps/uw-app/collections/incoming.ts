import { and, eq, like, ne } from 'drizzle-orm';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageLinks, pages } from '@uw/db/schema';
import { areaFilter } from '../pages/reads.ts';

export type Incoming = {
  readonly rel: string;
  readonly id: string;
  readonly title: string;
  readonly collectionId: string | null;
};

export async function incomingRelations(
  db: Executor,
  actor: Principal,
  rowId: string,
  at: Date,
): Promise<readonly Incoming[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  return db
    .select({
      rel: pageLinks.rel,
      id: pages.id,
      title: pages.title,
      collectionId: pages.collectionId,
    })
    .from(pageLinks)
    .innerJoin(pages, eq(pages.id, pageLinks.fromPage))
    .where(
      and(
        eq(pageLinks.toPage, rowId),
        like(pageLinks.rel, '%.%'),
        ne(pages.status, 'retired'),
        areas,
      ),
    )
    .orderBy(pageLinks.rel, pages.title)
    .limit(200);
}
