import { and, asc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { pageEntrySchema, type JdArea, type PageEntry } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageLinks, pages } from '@uw/db/schema';
import { pageRefs, rewriteWikiRefs, wikiRefs, type Resolved } from '../markdown/wiki-syntax.ts';
import { areaFilter } from './reads.ts';

export type Resolve = (target: string) => Resolved | null;

type Candidate = {
  readonly id: string;
  readonly title: string;
  readonly jdArea: string;
  readonly jdId: string | null;
  readonly aliases: readonly string[];
};

const JD_PREFIX = /^[0-9]{2}\.[0-9]{2}\s+/;
const titleSansId = sql<string>`lower(regexp_replace(${pages.title}, '^[0-9]{2}\\.[0-9]{2}\\s+', ''))`;
const aliasesOf = sql<string[]>`coalesce(${pages.frontmatter}->'aliases', '[]'::jsonb)`;
const jdIdOf = sql<string | null>`${pages.frontmatter}->>'jd_id'`;

function wantedBy(targets: readonly string[]): SQL | undefined {
  const names = sql.join(
    targets.map((target) => sql`${target}`),
    sql`, `,
  );
  const hasAlias = sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${aliasesOf}) AS alias WHERE lower(alias) IN (${names}))`;
  return or(
    sql`lower(${pages.title}) IN (${names})`,
    sql`${titleSansId} IN (${names})`,
    sql`lower(${jdIdOf}) IN (${names})`,
    hasAlias,
  );
}

async function candidatesFor(
  db: Executor,
  actor: Principal,
  targets: readonly string[],
  at: Date,
): Promise<readonly Candidate[]> {
  const areas = areaFilter(actor, at);
  if (areas === null || targets.length === 0) return [];
  const rows = await db
    .select({
      id: pages.id,
      title: pages.title,
      jdArea: pages.jdArea,
      jdId: jdIdOf,
      aliases: aliasesOf,
    })
    .from(pages)
    .where(and(areas, ne(pages.status, 'retired'), wantedBy(targets)));
  return rows.map((row) => ({ ...row, aliases: Array.isArray(row.aliases) ? row.aliases : [] }));
}

const tiers: readonly ((page: Candidate, wanted: string) => boolean)[] = [
  (page, wanted) => page.jdId?.toLowerCase() === wanted,
  (page, wanted) => page.title.toLowerCase() === wanted,
  (page, wanted) => page.title.replace(JD_PREFIX, '').toLowerCase() === wanted,
  (page, wanted) => page.aliases.some((alias) => alias.toLowerCase() === wanted),
];

function pick(
  candidates: readonly Candidate[],
  wanted: string,
  area: JdArea | null,
): Resolved | null {
  for (const matches of tiers) {
    const found = candidates.filter((page) => matches(page, wanted));
    const near = found.filter((page) => page.jdArea === area);
    const chosen = found.length === 1 ? found[0] : near.length === 1 ? near[0] : undefined;
    if (chosen !== undefined) return { id: chosen.id, title: chosen.title };
    if (found.length > 0) return null;
  }
  return null;
}

export async function resolverFor(
  db: Executor,
  actor: Principal,
  wanted: { readonly targets: readonly string[]; readonly area: JdArea | null },
  at: Date,
): Promise<Resolve> {
  const targets = [...new Set(wanted.targets.map((target) => target.toLowerCase()))];
  const candidates = await candidatesFor(db, actor, targets, at);
  return (target) => pick(candidates, target.toLowerCase(), wanted.area);
}

export async function resolveBody(
  db: Executor,
  actor: Principal,
  body: { readonly bodyMd: string; readonly area: JdArea },
  at: Date,
): Promise<string> {
  const refs = wikiRefs(body.bodyMd);
  if (refs.length === 0) return body.bodyMd;
  const targets = refs.map((ref) => ref.target);
  const resolve = await resolverFor(db, actor, { targets, area: body.area }, at);
  return rewriteWikiRefs(body.bodyMd, resolve);
}

async function existing(tx: Executor, ids: readonly string[]): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: pages.id })
    .from(pages)
    .where(inArray(pages.id, [...ids]));
  return new Set(rows.map((row) => row.id));
}

export async function embedsItself(tx: Executor, pageId: string, bodyMd: string): Promise<boolean> {
  const embedded = [...new Set(pageRefs(bodyMd).embeds.map((embed) => embed.id))];
  if (embedded.length === 0) return false;
  if (embedded.includes(pageId)) return true;
  const starts = sql.join(
    embedded.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tx.execute(sql`
    WITH RECURSIVE reach(id) AS (
      SELECT to_page FROM page_links WHERE rel = 'embeds' AND from_page IN (${starts})
      UNION
      SELECT l.to_page FROM page_links l JOIN reach r ON l.from_page = r.id WHERE l.rel = 'embeds'
    )
    SELECT 1 FROM reach WHERE id = ${pageId}::uuid LIMIT 1`);
  return rows.length > 0;
}

export const BODY_RELS = ['links', 'embeds', 'unresolved'] as const;

export async function rebuildLinks(tx: Executor, pageId: string, bodyMd: string): Promise<void> {
  const refs = pageRefs(bodyMd);
  const known = await existing(tx, [...refs.links, ...refs.embeds.map((embed) => embed.id)]);
  const embedded = [...new Set(refs.embeds.map((embed) => embed.id))];
  const unresolved = [...new Set(wikiRefs(bodyMd).map((ref) => ref.target))];
  const rows = [
    ...refs.links.filter((id) => known.has(id)).map((id) => ({ toPage: id, rel: 'links' })),
    ...embedded.filter((id) => known.has(id)).map((id) => ({ toPage: id, rel: 'embeds' })),
    ...unresolved.map((wanted) => ({ toPage: null, rel: 'unresolved', wanted })),
  ];
  await tx
    .delete(pageLinks)
    .where(and(eq(pageLinks.fromPage, pageId), inArray(pageLinks.rel, [...BODY_RELS])));
  if (rows.length === 0) return;
  await tx
    .insert(pageLinks)
    .values(rows.map((row) => ({ fromPage: pageId, wanted: null, ...row })));
}

export async function backlinksOf(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<readonly PageEntry[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const rows = await db
    .selectDistinct({
      id: pages.id,
      type: pages.type,
      jdArea: pages.jdArea,
      slug: pages.slug,
      title: pages.title,
      status: pages.status,
      parentId: pages.parentId,
      version: pages.version,
      category: sql<string | null>`${pages.frontmatter}->>'jd_category'`,
      jdId: jdIdOf,
      updatedAt: pages.updatedAt,
    })
    .from(pageLinks)
    .innerJoin(pages, eq(pages.id, pageLinks.fromPage))
    .where(
      and(
        eq(pageLinks.toPage, pageId),
        inArray(pageLinks.rel, [...BODY_RELS]),
        ne(pages.status, 'retired'),
        areas,
      ),
    )
    .orderBy(asc(pages.title));
  return rows.map((row) =>
    pageEntrySchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() }),
  );
}
