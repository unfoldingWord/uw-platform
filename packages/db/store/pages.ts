import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  frontmatterSchema,
  pageStatusSchema,
  pageTypeSchema,
  platformPageSlug,
} from '@uw/contracts';
import { isoDateSchema } from '@uw/core/dates';
import type { AnyExecutor } from '../any-database.ts';
import { pages, pageVersions } from '../schema.ts';
import type { PageFacts, PagesGateway, PersonaActivation } from './types.ts';

export const factColumns = {
  id: pages.id,
  type: pages.type,
  status: pages.status,
  jdArea: pages.jdArea,
  title: pages.title,
  bodyMd: pages.bodyMd,
  frontmatter: pages.frontmatter,
  version: pages.version,
};

type FactRow = { [K in keyof typeof factColumns]: (typeof factColumns)[K]['_']['data'] };

export function toFacts(row: FactRow): PageFacts {
  return {
    id: row.id,
    jdArea: row.jdArea,
    title: row.title,
    bodyMd: row.bodyMd,
    version: row.version,
    type: pageTypeSchema.parse(row.type),
    status: pageStatusSchema.parse(row.status),
    frontmatter: frontmatterSchema.parse(row.frontmatter),
  };
}

async function factsWhere(executor: AnyExecutor, where: SQL | undefined) {
  const rows = await executor.select(factColumns).from(pages).where(where).orderBy(asc(pages.id));
  return rows.map(toFacts);
}

const maxLearnings = 5000;
const isoDayPattern = '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

function dateField(field: 'review_by' | 'as_of'): SQL {
  const text = sql`(${pages.frontmatter}->>${field})`;
  return sql`CASE WHEN ${text} ~ ${isoDayPattern} AND pg_input_is_valid(${text}, 'date') THEN ${text}::date END`;
}

async function staleLearnings(
  executor: AnyExecutor,
  today: string,
  limit: number,
): Promise<readonly PageFacts[]> {
  const day = isoDateSchema.safeParse(today);
  if (!day.success) throw new RangeError(`today is a calendar date, not ${today}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLearnings) {
    throw new RangeError(`a learning read holds 1 to ${maxLearnings} pages, not ${limit}`);
  }
  const reviewBy = sql`coalesce(${dateField('review_by')}, ${dateField('as_of')} + 90)`;
  const rows = await executor
    .select(factColumns)
    .from(pages)
    .where(
      and(
        eq(pages.type, 'learning'),
        ne(pages.status, 'retired'),
        inArray(sql`${pages.frontmatter}->>'confidence'`, ['assumed', 'inferred']),
        sql`${reviewBy} < ${day.data}::date`,
      ),
    )
    .orderBy(asc(pages.id))
    .limit(limit);
  return rows.map(toFacts);
}

async function activatePersona(
  executor: AnyExecutor,
  activation: PersonaActivation,
): Promise<PageFacts | null> {
  const [row] = await executor
    .update(pages)
    .set({
      status: 'active',
      version: sql`${pages.version} + 1`,
      frontmatter: sql`jsonb_set(${pages.frontmatter}, '{status}', '"active"')`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(pages.id, activation.pageId),
        eq(pages.type, 'persona'),
        eq(pages.status, 'suggested'),
        eq(pages.version, activation.expectedVersion),
      ),
    )
    .returning();
  if (row === undefined) return null;
  await executor.insert(pageVersions).values({
    pageId: row.id,
    version: row.version,
    type: row.type,
    jdArea: row.jdArea,
    slug: row.slug,
    title: row.title,
    parentId: row.parentId,
    frontmatter: row.frontmatter,
    bodyMd: row.bodyMd,
    status: row.status,
    editSource: activation.editSource,
    traceId: activation.traceId,
  });
  return toFacts(row);
}

async function platformFor(executor: AnyExecutor, jdArea: string): Promise<PageFacts | null> {
  const [row] = await executor
    .select(factColumns)
    .from(pages)
    .where(
      and(eq(pages.jdArea, jdArea), eq(pages.slug, platformPageSlug), eq(pages.type, 'platform')),
    )
    .limit(1);
  return row === undefined ? null : toFacts(row);
}

export function bindPages(executor: AnyExecutor): PagesGateway {
  return {
    read: {
      facts: async (pageIds) => {
        if (pageIds.length === 0) return [];
        return factsWhere(executor, inArray(pages.id, [...pageIds]));
      },
      staleLearnings: (today, limit) => staleLearnings(executor, today, limit),
      platformFor: (jdArea) => platformFor(executor, jdArea),
    },
    write: { activatePersona: (activation) => activatePersona(executor, activation) },
  };
}
