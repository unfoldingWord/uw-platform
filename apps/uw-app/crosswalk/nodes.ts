import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { cascadeTierSchema, type CascadeTier } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';

export type CascadeNode = {
  readonly id: string;
  readonly title: string;
  readonly tier: CascadeTier;
  readonly jdArea: string;
};

export const tiers: readonly CascadeTier[] = cascadeTierSchema.options;

export const isNode = and(inArray(pages.type, [...tiers]), ne(pages.status, 'retired'));

export async function cascadeNode(db: Executor, id: string): Promise<CascadeNode | null> {
  const [row] = await db
    .select({ id: pages.id, title: pages.title, type: pages.type, jdArea: pages.jdArea })
    .from(pages)
    .where(and(eq(pages.id, id), isNode));
  if (row === undefined) return null;
  return {
    id: row.id,
    title: row.title,
    tier: cascadeTierSchema.parse(row.type),
    jdArea: row.jdArea,
  };
}

export async function cascadeNodes(db: Executor): Promise<readonly CascadeNode[]> {
  const rows = await db
    .select({ id: pages.id, title: pages.title, type: pages.type, jdArea: pages.jdArea })
    .from(pages)
    .where(isNode)
    .orderBy(asc(pages.type), asc(pages.title));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    tier: cascadeTierSchema.parse(row.type),
    jdArea: row.jdArea,
  }));
}
