import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { jdAreaSchema, pageSchema, type JdArea, type PageType } from '@uw/contracts';
import { readableAreas } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';

const summarySchema = pageSchema.pick({
  id: true,
  type: true,
  jdArea: true,
  slug: true,
  title: true,
  status: true,
});

type PageSummary = z.infer<typeof summarySchema>;

type PageQuery = {
  readonly text: string;
  readonly type: PageType | null;
  readonly limit: number;
};

export async function pageArea(db: Executor, pageId: string): Promise<JdArea | null> {
  const [row] = await db.select({ jdArea: pages.jdArea }).from(pages).where(eq(pages.id, pageId));
  return row ? jdAreaSchema.parse(row.jdArea) : null;
}

function areaFilter(actor: Principal, at: Date): SQL | undefined | null {
  const readable = readableAreas(actor, at);
  if (readable.kind === 'all') return undefined;
  if (readable.areas.length === 0) return null;
  return inArray(pages.jdArea, [...readable.areas]);
}

export async function searchPages(
  db: Executor,
  actor: Principal,
  query: PageQuery,
  at: Date,
): Promise<readonly PageSummary[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const document = sql`to_tsvector('simple', ${pages.title} || ' ' || ${pages.bodyMd})`;
  const terms = sql`websearch_to_tsquery('simple', ${query.text})`;
  const rows = await db
    .select({
      id: pages.id,
      type: pages.type,
      jdArea: pages.jdArea,
      slug: pages.slug,
      title: pages.title,
      status: pages.status,
    })
    .from(pages)
    .where(
      and(
        sql`${document} @@ ${terms}`,
        query.type === null ? undefined : eq(pages.type, query.type),
        areas,
      ),
    )
    .orderBy(desc(sql`ts_rank(${document}, ${terms})`), pages.id)
    .limit(query.limit);
  return rows.map((row) => summarySchema.parse(row));
}
