import { eq, inArray, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { jdAreaSchema, pageSchema, type JdArea } from '@uw/contracts';
import { readableAreas } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';

export const summarySchema = pageSchema.pick({
  id: true,
  type: true,
  jdArea: true,
  slug: true,
  title: true,
  status: true,
});

export type PageSummary = z.infer<typeof summarySchema>;

export const summaryColumns = {
  id: pages.id,
  type: pages.type,
  jdArea: pages.jdArea,
  slug: pages.slug,
  title: pages.title,
  status: pages.status,
};

export async function pageArea(db: Executor, pageId: string): Promise<JdArea | null> {
  const [row] = await db.select({ jdArea: pages.jdArea }).from(pages).where(eq(pages.id, pageId));
  return row ? jdAreaSchema.parse(row.jdArea) : null;
}

export function areaFilter(actor: Principal, at: Date): SQL | undefined | null {
  const readable = readableAreas(actor, at);
  if (readable.kind === 'all') return undefined;
  if (readable.areas.length === 0) return null;
  return inArray(pages.jdArea, [...readable.areas]);
}
