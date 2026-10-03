import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { frontmatterSchema, pageStatusSchema, pageTypeSchema } from '@uw/contracts';
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

async function factsWhere(executor: AnyExecutor, where: SQL | undefined, order: readonly SQL[]) {
  const rows = await executor
    .select(factColumns)
    .from(pages)
    .where(where)
    .orderBy(...order);
  return rows.map(toFacts);
}

export function bindPages(executor: AnyExecutor): PagesGateway {
  return {
    read: {
      facts: async (pageIds) => {
        if (pageIds.length === 0) return [];
        return factsWhere(executor, inArray(pages.id, [...pageIds]), [asc(pages.id)]);
      },
      activePersona: async (identity, harnessId) => {
        const rows = await factsWhere(
          executor,
          and(
            eq(pages.type, 'persona'),
            eq(pages.status, 'active'),
            eq(sql`${pages.frontmatter}->>'identity'`, identity),
            eq(sql`${pages.frontmatter}->>'harness'`, harnessId),
          ),
          [desc(pages.version), asc(pages.id)],
        );
        return rows[0] ?? null;
      },
    },
  };
}
