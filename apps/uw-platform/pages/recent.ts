import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { pageIndexEntrySchema, type PageIndexEntry } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages, pageViews } from '@uw/db/schema';
import { areaFilter } from './reads.ts';

const RECENT_SHOWN = 10;

export async function recordView(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<void> {
  if (actor.kind !== 'person' || actor.personId === null) return;
  await db
    .insert(pageViews)
    .values({ personId: actor.personId, pageId, viewedAt: at })
    .onConflictDoUpdate({
      target: [pageViews.personId, pageViews.pageId],
      set: { viewedAt: at },
    });
}

export async function recentPages(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly PageIndexEntry[]> {
  const areas = areaFilter(actor, at);
  if (areas === null || actor.personId === null) return [];
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      type: pages.type,
      jdArea: pages.jdArea,
      jdId: sql<string | null>`${pages.frontmatter}->>'jd_id'`,
      aliases: sql<unknown>`coalesce(${pages.frontmatter}->'aliases', '[]'::jsonb)`,
    })
    .from(pageViews)
    .innerJoin(pages, eq(pages.id, pageViews.pageId))
    .where(and(eq(pageViews.personId, actor.personId), ne(pages.status, 'retired'), areas))
    .orderBy(desc(pageViews.viewedAt))
    .limit(RECENT_SHOWN);
  return rows.map((row) => pageIndexEntrySchema.parse(row));
}
