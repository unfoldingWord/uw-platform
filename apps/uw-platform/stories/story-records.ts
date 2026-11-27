import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  expressionFormats,
  impactStoryFrontmatterSchema,
  pageStatusSchema,
  sensitivityLevelSchema,
  storyExpressionSchema,
  storyRecordSchema,
  storySummarySchema,
  type ConsentState,
  type ExpressionFormat,
  type ListStoriesInput,
  type SensitivityLevel,
  type StoryExpression,
  type StoryRecord,
  type StorySummary,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages, storyLevels } from '@uw/db/schema';
import { areaFilter } from '../pages/reads.ts';
import { STORY_TYPE } from './channel-filter.ts';
import {
  consentHistoriesOf,
  consentRowOf,
  consentRowsOf,
  consentStateOf,
  type ConsentRow,
} from './consent.ts';
import type { ConsentHistory } from './consent-interval.ts';
import { flagCounts, flagsOf } from './expression-flags.ts';
import { expressionRowsOf, type ExpressionRow } from './expression-rows.ts';
import { storyUsesOf } from './uses.ts';

type Told = { readonly level: SensitivityLevel; readonly consent: ConsentHistory };

export function shapedExpression(row: ExpressionRow, told: Told): StoryExpression {
  return storyExpressionSchema.parse({
    id: row.id,
    storyId: row.pageId,
    kind: row.kind,
    title: row.title,
    format: row.format,
    venue: row.venue,
    channel: row.channel,
    url: row.url,
    nativePageId: row.nativePageId,
    language: row.language,
    publishedOn: row.publishedOn,
    excerpt: row.excerpt,
    status: row.status,
    addedBy: row.addedBy,
    addedAt: row.addedAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    flags: flagsOf(
      {
        channel: storyExpressionSchema.shape.channel.parse(row.channel),
        publishedOn: row.publishedOn,
      },
      told.level,
      told.consent,
    ),
  });
}

function levelOrInternal(level: string | null): SensitivityLevel {
  return level === null ? 'internal' : sensitivityLevelSchema.parse(level);
}

async function levelsOf(db: Executor, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, SensitivityLevel>();
  const rows = await db
    .select({ pageId: storyLevels.pageId, level: storyLevels.level })
    .from(storyLevels)
    .where(inArray(storyLevels.pageId, [...ids]));
  return new Map(rows.map((row) => [row.pageId, levelOrInternal(row.level)]));
}

async function expressionsOfStories(
  db: Executor,
  ids: readonly string[],
): Promise<ReadonlyMap<string, readonly StoryExpression[]>> {
  const levels = await levelsOf(db, ids);
  const histories = await consentHistoriesOf(db, ids);
  const shaped = new Map<string, StoryExpression[]>(ids.map((id) => [id, []]));
  for (const row of await expressionRowsOf(db, ids)) {
    const told = {
      level: levels.get(row.pageId) ?? 'internal',
      consent: histories.get(row.pageId) ?? [],
    };
    shaped.get(row.pageId)?.push(shapedExpression(row, told));
  }
  return shaped;
}

export async function expressionsOfStory(db: Executor, pageId: string) {
  return (await expressionsOfStories(db, [pageId])).get(pageId) ?? [];
}

export function byFormat(expressions: readonly StoryExpression[]) {
  return expressionFormats.flatMap((format) => {
    const told = expressions.filter((expression) => expression.format === format);
    return told.length === 0 ? [] : [{ format, expressions: told }];
  });
}

function consentStateFor(row: ConsentRow | null, at: Date): ConsentState {
  return row === null ? 'none' : consentStateOf(row, at);
}

function consentRecordFor(actor: Principal, area: string, row: ConsentRow | null, at: Date) {
  const rule = { kind: 'row', table: 'story_consents', area, ownerId: null } as const;
  if (row === null || !can(actor, 'read', rule, at)) return null;
  const { consentReference, consentedBy, consentForm, consentedOn, consentExpires } = row;
  const { anonymised, nameUse, locationPrecision, photoRelease, photoReference, reviewOn } = row;
  return {
    ...{ consentReference, consentedBy, consentForm, consentedOn, consentExpires },
    ...{ anonymised, nameUse, locationPrecision, photoRelease, photoReference, reviewOn },
  };
}

export async function programsShown(
  db: Executor,
  actor: Principal,
  ids: readonly string[],
  at: Date,
): Promise<readonly { readonly id: string; readonly title: string }[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: pages.id, title: pages.title, jdArea: pages.jdArea })
    .from(pages)
    .where(and(inArray(pages.id, [...ids]), eq(pages.type, 'program')))
    .orderBy(asc(pages.title), asc(pages.id));
  return rows
    .filter((row) => can(actor, 'read', { kind: 'area', area: row.jdArea }, at))
    .map(({ id, title }) => ({ id, title }));
}

const recordColumns = {
  id: pages.id,
  title: pages.title,
  jdArea: pages.jdArea,
  status: pages.status,
  version: pages.version,
  frontmatter: pages.frontmatter,
  level: storyLevels.level,
};

async function storyRow(db: Executor, storyId: string) {
  const [row] = await db
    .select(recordColumns)
    .from(pages)
    .leftJoin(storyLevels, eq(storyLevels.pageId, pages.id))
    .where(and(eq(pages.id, storyId), eq(pages.type, STORY_TYPE)));
  return row ?? null;
}

export async function storyRecordFor(
  db: Executor,
  actor: Principal,
  storyId: string,
  at: Date,
): Promise<StoryRecord | null> {
  const row = await storyRow(db, storyId);
  if (row === null || !can(actor, 'read', { kind: 'area', area: row.jdArea }, at)) return null;
  const record = impactStoryFrontmatterSchema.parse(row.frontmatter);
  const consent = await consentRowOf(db, row.id);
  const expressions = await expressionsOfStory(db, row.id);
  return storyRecordSchema.parse({
    id: row.id,
    title: row.title,
    jdArea: row.jdArea,
    status: pageStatusSchema.parse(row.status),
    version: row.version,
    record,
    programs: await programsShown(db, actor, record.programs, at),
    level: levelOrInternal(row.level),
    consent: {
      state: consentStateFor(consent, at),
      record: consentRecordFor(actor, row.jdArea, consent, at),
    },
    expressions: byFormat(expressions),
    uses: await storyUsesOf(db, row.id),
    flags: flagCounts(expressions),
  });
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (special) => `\\${special}`)}%`;
}

function toldIn(format: ExpressionFormat): SQL {
  return sql`EXISTS (SELECT 1 FROM story_expressions e WHERE e.page_id = ${pages.id} AND e.format = ${format} AND e.status <> 'retired')`;
}

function filtersOf(filters: ListStoriesInput): (SQL | undefined)[] {
  const { query, program, country, formatPresent, formatAbsent } = filters;
  return [
    query === null ? undefined : sql`${pages.title} ILIKE ${likePattern(query)}`,
    program === null
      ? undefined
      : sql`${pages.frontmatter} -> 'programs' @> ${JSON.stringify([program])}::jsonb`,
    country === null ? undefined : sql`${pages.frontmatter} ->> 'country' = ${country}`,
    formatPresent === null ? undefined : toldIn(formatPresent),
    formatAbsent === null ? undefined : sql`NOT ${toldIn(formatAbsent)}`,
  ];
}

export async function storySummaries(
  db: Executor,
  actor: Principal,
  filters: ListStoriesInput,
  at: Date,
): Promise<readonly StorySummary[]> {
  const areas = areaFilter(actor, at);
  if (areas === null) return [];
  const rows = await db
    .select(recordColumns)
    .from(pages)
    .leftJoin(storyLevels, eq(storyLevels.pageId, pages.id))
    .where(
      and(eq(pages.type, STORY_TYPE), ne(pages.status, 'retired'), areas, ...filtersOf(filters)),
    )
    .orderBy(asc(pages.title), asc(pages.id))
    .limit(filters.limit);
  const ids = rows.map((row) => row.id);
  const told = await expressionsOfStories(db, ids);
  const consents = await consentRowsOf(db, ids);
  return rows.map((row) =>
    summaryOf(row, told.get(row.id) ?? [], consentStateFor(consents.get(row.id) ?? null, at)),
  );
}

type SummaryRow = Awaited<ReturnType<typeof storyRow>> & {};

function summaryOf(
  row: SummaryRow,
  expressions: readonly StoryExpression[],
  consent: ConsentState,
): StorySummary {
  const record = impactStoryFrontmatterSchema.parse(row.frontmatter);
  const live = expressions.filter((expression) => expression.status !== 'retired');
  const days = live.flatMap((expression) => expression.publishedOn ?? []).sort();
  return storySummarySchema.parse({
    id: row.id,
    title: row.title,
    jdArea: row.jdArea,
    status: row.status,
    occurredOn: record.occurred_on,
    place: record.place,
    country: record.country,
    region: record.region,
    programs: record.programs,
    level: levelOrInternal(row.level),
    consent,
    expressionCount: live.length,
    formats: expressionFormats.filter((format) => live.some((each) => each.format === format)),
    lastToldOn: days.at(-1) ?? null,
    flags: flagCounts(expressions),
  });
}
