import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type { JdArea, PageType } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { SEARCH_LANGUAGE, searchDocument, searchTerms, titleDocument } from '@uw/db/page-search';
import { pages } from '@uw/db/schema';
import { areaFilter, summaryColumns, summarySchema, type PageSummary } from './reads.ts';

export type SearchQuery = {
  readonly text: string;
  readonly type: PageType | null;
  readonly area: JdArea | null;
  readonly titlesOnly: boolean;
  readonly liveOnly: boolean;
  readonly owner?: string | null;
  readonly since?: string | null;
  readonly limit: number;
};

type SnippetPart = { readonly text: string; readonly hit: boolean };
export type SearchResult = { readonly page: PageSummary; readonly snippet: readonly SnippetPart[] };

const HIT_START = '';
const HIT_END = '';
const SNIPPET_SOURCE = 20_000;
const headlineOptions = `StartSel=${HIT_START}, StopSel=${HIT_END}, MaxFragments=2, MaxWords=20, MinWords=8, FragmentDelimiter=" … "`;

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (special) => `\\${special}`)}%`;
}

function matching(query: SearchQuery, terms: SQL): SQL | undefined {
  const document = query.titlesOnly ? titleDocument(pages.title) : searchDocument(pages);
  const inTitle = sql`${pages.title} ILIKE ${likePattern(query.text.trim())}`;
  return or(sql`${document} @@ ${terms}`, inTitle);
}

function narrowing(query: SearchQuery): (SQL | undefined)[] {
  const owner = query.owner ?? null;
  const since = query.since ?? null;
  return [
    owner === null ? undefined : sql`${pages.frontmatter}->>'owner' = ${owner}`,
    since === null ? undefined : sql`${pages.updatedAt} >= ${since}::date`,
  ];
}

export async function searchPages(
  db: Executor,
  actor: Principal,
  query: SearchQuery,
  at: Date,
): Promise<readonly PageSummary[]> {
  const areas = areaFilter(actor, at);
  if (areas === null || query.text.trim() === '') return [];
  const terms = searchTerms(query.text);
  const rows = await db
    .select(summaryColumns)
    .from(pages)
    .where(
      and(
        matching(query, terms),
        query.type === null ? undefined : eq(pages.type, query.type),
        query.area === null ? undefined : eq(pages.jdArea, query.area),
        query.liveOnly ? ne(pages.status, 'retired') : undefined,
        ...narrowing(query),
        areas,
      ),
    )
    .orderBy(desc(sql`ts_rank(${searchDocument(pages)}, ${terms})`), asc(pages.title), pages.id)
    .limit(query.limit);
  return rows.map((row) => summarySchema.parse(row));
}

function partsOf(headline: string): readonly SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const piece of headline.split(HIT_START)) {
    const [inside, after] = piece.includes(HIT_END) ? piece.split(HIT_END) : [null, piece];
    if (inside !== null && inside !== undefined) parts.push({ text: inside, hit: true });
    if (after !== undefined && after !== '') parts.push({ text: after, hit: false });
  }
  return parts;
}

export async function searchWithSnippets(
  db: Executor,
  actor: Principal,
  query: SearchQuery,
  at: Date,
): Promise<readonly SearchResult[]> {
  const found = await searchPages(db, actor, query, at);
  if (found.length === 0) return [];
  const language = sql.raw(`'${SEARCH_LANGUAGE}'`);
  const source = sql`left(${pages.bodyMd}, ${sql.raw(String(SNIPPET_SOURCE))})`;
  const rows = await db
    .select({
      id: pages.id,
      headline: sql<string>`ts_headline(${language}, ${source}, ${searchTerms(query.text)}, ${headlineOptions})`,
    })
    .from(pages)
    .where(
      inArray(
        pages.id,
        found.map((page) => page.id),
      ),
    );
  const headlines = new Map(rows.map((row) => [row.id, row.headline]));
  return found.map((page) => ({ page, snippet: partsOf(headlines.get(page.id) ?? '') }));
}
