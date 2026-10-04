import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  frontmatterSchema,
  pageStatusSchema,
  pageTypeSchema,
  personaFrontmatterSchema,
  type Identity,
} from '@uw/contracts';
import { isoDateSchema } from '@uw/core/dates';
import type { AnyExecutor } from '../any-database.ts';
import { pages } from '../schema.ts';
import type { PageFacts, PagesGateway } from './types.ts';

const factColumns = {
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

function toFacts(row: FactRow): PageFacts {
  return {
    ...row,
    type: pageTypeSchema.parse(row.type),
    status: pageStatusSchema.parse(row.status),
    frontmatter: frontmatterSchema.parse(row.frontmatter),
  };
}

async function factsWhere(executor: AnyExecutor, where: SQL | undefined) {
  const rows = await executor.select(factColumns).from(pages).where(where).orderBy(asc(pages.id));
  return rows.map(toFacts);
}

async function activePersona(
  executor: AnyExecutor,
  identity: Identity,
  harnessId: string,
): Promise<PageFacts | null> {
  const rows = await executor
    .select(factColumns)
    .from(pages)
    .where(
      and(
        eq(pages.type, 'persona'),
        eq(pages.status, 'active'),
        eq(sql`${pages.frontmatter}->>'identity'`, identity),
        eq(sql`${pages.frontmatter}->>'harness'`, harnessId),
      ),
    )
    .orderBy(asc(pages.id))
    .limit(2);
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) return null;
  const frontmatter = frontmatterSchema.safeParse(row.frontmatter);
  if (!frontmatter.success || !personaFrontmatterSchema.safeParse(row.frontmatter).success) {
    return null;
  }
  return { ...row, type: 'persona', status: 'active', frontmatter: frontmatter.data };
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

export function bindPages(executor: AnyExecutor): PagesGateway {
  return {
    read: {
      facts: async (pageIds) => {
        if (pageIds.length === 0) return [];
        return factsWhere(executor, inArray(pages.id, [...pageIds]));
      },
      activePersona: (identity, harnessId) => activePersona(executor, identity, harnessId),
      staleLearnings: (today, limit) => staleLearnings(executor, today, limit),
    },
  };
}
