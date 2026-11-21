import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  areaOfCategory,
  jdAreaSchema,
  pageCategorySchema,
  type ErrorReason,
  type JdCategory,
  type NameCategoryCommand,
  type PageCategory,
  type PageEntry,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor } from '@uw/db/client';
import { jdCategories, pages } from '@uw/db/schema';
import { listPages } from './listing.ts';
import { areaFilter } from './reads.ts';

const LISTED = 'knowledge';
const PAGE_SIZE = 200;
const MOST_PAGES = 2_000;

const filedIn = sql<string>`${pages.frontmatter}->>'jd_category'`;

export async function categoryCounts(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly PageCategory[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const rows = await db
    .select({
      code: filedIn,
      area: pages.jdArea,
      name: sql<string | null>`max(${jdCategories.name})`,
      pages: sql<number>`count(*)::int`,
    })
    .from(pages)
    .leftJoin(jdCategories, sql`${jdCategories.code} = ${filedIn}`)
    .where(and(areas, eq(pages.type, LISTED), ne(pages.status, 'retired')))
    .groupBy(filedIn, pages.jdArea)
    .orderBy(asc(filedIn));
  return rows.map((row) => pageCategorySchema.parse(row));
}

export async function categoryName(db: Executor, category: JdCategory): Promise<string | null> {
  const [row] = await db
    .select({ name: jdCategories.name })
    .from(jdCategories)
    .where(eq(jdCategories.code, category));
  return row?.name ?? null;
}

export async function pagesInCategory(
  db: Executor,
  actor: Principal,
  category: JdCategory,
  at: Date,
): Promise<readonly PageEntry[] | null> {
  const area = jdAreaSchema.parse(areaOfCategory(category));
  if (!can(actor, 'read', { kind: 'area', area }, at)) return null;
  const found: PageEntry[] = [];
  let cursor: string | undefined;
  do {
    const query = { category, type: LISTED, limit: PAGE_SIZE, cursor } as const;
    const page = await listPages(db, actor, query, at);
    if (page === null) break;
    found.push(...page.pages);
    cursor = page.next ?? undefined;
  } while (cursor !== undefined && found.length < MOST_PAGES);
  return found;
}

export async function nameCategory(
  db: Database,
  actor: Principal,
  command: NameCategoryCommand,
  at: Date,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: ErrorReason }> {
  const area = jdAreaSchema.parse(areaOfCategory(command.category));
  if (!can(actor, 'admin', { kind: 'area', area }, at))
    return { ok: false, reason: 'not_permitted' };
  const name = command.name.trim();
  await db
    .insert(jdCategories)
    .values({ code: command.category, name, updatedAt: at })
    .onConflictDoUpdate({ target: jdCategories.code, set: { name, updatedAt: at } });
  return { ok: true };
}
