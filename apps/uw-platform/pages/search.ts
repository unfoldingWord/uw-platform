import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type { JdArea, PageType, RenderChannel } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { SEARCH_LANGUAGE, searchDocument, searchTerms, titleDocument } from '@uw/db/page-search';
import { pages } from '@uw/db/schema';
import { readFilter, summaryColumns, summarySchema, type PageSummary } from './reads.ts';

export type SearchQuery = {
  readonly text: string;
  readonly type: PageType | null;
  readonly area: JdArea | null;
  readonly titlesOnly: boolean;
  readonly liveOnly: boolean;
  readonly owner?: string | null;
  readonly since?: string | null;
  readonly similar?: boolean;
  readonly channel?: RenderChannel;
  readonly limit: number;
};

type Match = 'words' | 'similar_title';

type SnippetPart = { readonly text: string; readonly hit: boolean };
export type SearchResult = {
  readonly page: PageSummary;
  readonly snippet: readonly SnippetPart[];
  readonly match: Match;
};

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

function filtersOf(query: SearchQuery, areas: SQL | undefined): (SQL | undefined)[] {
  return [
    query.type === null ? undefined : eq(pages.type, query.type),
    query.area === null ? undefined : eq(pages.jdArea, query.area),
    query.liveOnly ? ne(pages.status, 'retired') : undefined,
    ...narrowing(query),
    areas,
  ];
}

function narrowing(query: SearchQuery): (SQL | undefined)[] {
  const owner = query.owner ?? null;
  const since = query.since ?? null;
  return [
    owner === null ? undefined : sql`${pages.frontmatter}->>'owner' = ${owner}`,
    since === null ? undefined : sql`${pages.updatedAt} >= ${since}::date`,
  ];
}

type Found = { readonly pages: readonly PageSummary[]; readonly match: Match };

async function similarTitles(
  db: Executor,
  query: SearchQuery,
  areas: SQL | undefined,
): Promise<readonly PageSummary[]> {
  const text = query.text.trim().toLowerCase();
  const closeness = sql`greatest(similarity(${pages.title}, ${text}), word_similarity(${text}, ${pages.title}))`;
  const rows = await db
    .select(summaryColumns)
    .from(pages)
    .where(
      and(
        or(sql`${pages.title} % ${text}`, sql`${text} <% ${pages.title}`),
        ...filtersOf(query, areas),
      ),
    )
    .orderBy(desc(closeness), asc(pages.title), pages.id)
    .limit(query.limit);
  return rows.map((row) => summarySchema.parse(row));
}

async function findPages(
  db: Executor,
  actor: Principal,
  query: SearchQuery,
  at: Date,
): Promise<Found> {
  const areas = readFilter(actor, at, query.channel ?? 'platform');
  if (areas === null || query.text.trim() === '') return { pages: [], match: 'words' };
  const words = await wordMatches(db, query, areas);
  if (words.length > 0 || query.similar !== true) return { pages: words, match: 'words' };
  return { pages: await similarTitles(db, query, areas), match: 'similar_title' };
}

export async function searchPages(
  db: Executor,
  actor: Principal,
  query: SearchQuery,
  at: Date,
): Promise<readonly PageSummary[]> {
  return (await findPages(db, actor, query, at)).pages;
}

async function wordMatches(
  db: Executor,
  query: SearchQuery,
  areas: SQL | undefined,
): Promise<readonly PageSummary[]> {
  const terms = searchTerms(query.text);
  const rows = await db
    .select(summaryColumns)
    .from(pages)
    .where(and(matching(query, terms), ...filtersOf(query, areas)))
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
  const { pages: found, match } = await findPages(db, actor, query, at);
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
  return found.map((page) => ({ page, snippet: partsOf(headlines.get(page.id) ?? ''), match }));
}
