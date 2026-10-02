import { asc, inArray } from 'drizzle-orm';
import { frontmatterSchema, pageStatusSchema, pageTypeSchema } from '@uw/contracts';
import type { AnyExecutor } from '../any-database.ts';
import { pages } from '../schema.ts';
import type { PagesGateway } from './types.ts';

export function bindPages(executor: AnyExecutor): PagesGateway {
  return {
    read: {
      facts: async (pageIds) => {
        if (pageIds.length === 0) return [];
        const rows = await executor
          .select({
            id: pages.id,
            type: pages.type,
            status: pages.status,
            jdArea: pages.jdArea,
            title: pages.title,
            bodyMd: pages.bodyMd,
            frontmatter: pages.frontmatter,
          })
          .from(pages)
          .where(inArray(pages.id, [...pageIds]))
          .orderBy(asc(pages.id));
        return rows.map((row) => ({
          ...row,
          type: pageTypeSchema.parse(row.type),
          status: pageStatusSchema.parse(row.status),
          frontmatter: frontmatterSchema.parse(row.frontmatter),
        }));
      },
    },
  };
}
