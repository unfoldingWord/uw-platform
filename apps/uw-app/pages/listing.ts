import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  pageEntrySchema,
  pageIndexEntrySchema,
  type PageEntry,
  type PageIndexEntry,
  type PageListQuery,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { areaFilter } from './reads.ts';

export type PageList = { readonly pages: readonly PageEntry[]; readonly next: string | null };

const cursorSchema = z.tuple([z.string(), z.uuid()]);
const MIRRORED = 'issue';
const INDEX_LIMIT = 20_000;

const category = sql<string | null>`${pages.frontmatter}->>'jd_category'`;
const jdId = sql<string | null>`${pages.frontmatter}->>'jd_id'`;

const entryColumns = {
  id: pages.id,
  type: pages.type,
  jdArea: pages.jdArea,
  slug: pages.slug,
  title: pages.title,
  status: pages.status,
  parentId: pages.parentId,
  version: pages.version,
  category,
  jdId,
  updatedAt: pages.updatedAt,
};

function encodeCursor(entry: PageEntry): string {
  return btoa(encodeURIComponent(JSON.stringify([entry.title, entry.id])));
}

function decodeCursor(raw: string): readonly [string, string] | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(decodeURIComponent(atob(raw))));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function after(cursor: string | undefined): SQL | undefined | null {
  if (cursor === undefined) return undefined;
  const decoded = decodeCursor(cursor);
  if (decoded === null) return null;
  return sql`(${pages.title}, ${pages.id}) > (${decoded[0]}, ${decoded[1]}::uuid)`;
}

function under(parent: PageListQuery['parent']): SQL | undefined {
  if (parent === undefined) return undefined;
  return parent === 'none' ? isNull(pages.parentId) : eq(pages.parentId, parent);
}

export async function listPages(
  db: Executor,
  actor: Principal,
  query: PageListQuery,
  at: Date,
): Promise<PageList | null> {
  const areas = areaFilter(actor, at);
  const from = after(query.cursor);
  if (from === null) return null;
  if (areas === null) return { pages: [], next: null };
  const rows = await db
    .select(entryColumns)
    .from(pages)
    .where(
      and(
        areas,
        from,
        under(query.parent),
        ne(pages.status, 'retired'),
        query.area === undefined ? undefined : eq(pages.jdArea, query.area),
        query.type === undefined ? undefined : eq(pages.type, query.type),
        query.category === undefined ? undefined : sql`${category} = ${query.category}`,
      ),
    )
    .orderBy(asc(pages.title), asc(pages.id))
    .limit(query.limit + 1);
  const entries = rows.map((row) =>
    pageEntrySchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() }),
  );
  const shown = entries.slice(0, query.limit);
  const last = shown.at(-1);
  const more = entries.length > query.limit && last !== undefined;
  return { pages: shown, next: more ? encodeCursor(last) : null };
}

export async function titleIndex(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly PageIndexEntry[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      type: pages.type,
      jdArea: pages.jdArea,
      jdId,
      aliases: sql<unknown>`coalesce(${pages.frontmatter}->'aliases', '[]'::jsonb)`,
    })
    .from(pages)
    .where(and(areas, ne(pages.status, 'retired'), ne(pages.type, MIRRORED)))
    .orderBy(asc(pages.title), asc(pages.id))
    .limit(INDEX_LIMIT);
  return rows.map((row) => pageIndexEntrySchema.parse(row));
}
