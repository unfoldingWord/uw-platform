import { inArray } from 'drizzle-orm';
import { pageStatusSchema, pageTypeSchema } from '@uw/contracts';
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
            bodyMd: pages.bodyMd,
          })
          .from(pages)
          .where(inArray(pages.id, [...pageIds]));
        return rows.map((row) => ({
          ...row,
          type: pageTypeSchema.parse(row.type),
          status: pageStatusSchema.parse(row.status),
        }));
      },
    },
  };
}
