import { and, asc, eq, ne } from 'drizzle-orm';
import { cascadeTierSchema, type CascadeTier, type PlacedEntityKind } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { cascadePlacements, pageLinks, pages } from '@uw/db/schema';
import { cascadeNode, type CascadeNode } from './nodes.ts';

export type CascadeLink = { readonly tier: CascadeTier; readonly pageId: string };

type Placed = { readonly kind: PlacedEntityKind; readonly id: string };

const parentOf: Readonly<Record<CascadeTier, CascadeTier | null>> = {
  project: 'program',
  program: 'portfolio',
  portfolio: null,
};

async function placementOf(db: Executor, entity: Placed): Promise<CascadeNode | null> {
  const [row] = await db
    .select({ node: cascadePlacements.cascadePageId })
    .from(cascadePlacements)
    .where(
      and(eq(cascadePlacements.entityKind, entity.kind), eq(cascadePlacements.entityId, entity.id)),
    );
  return row === undefined ? null : cascadeNode(db, row.node);
}

async function parentNode(db: Executor, node: CascadeNode): Promise<CascadeNode | null> {
  const parent = parentOf[node.tier];
  if (parent === null) return null;
  const [row] = await db
    .select({ id: pages.id })
    .from(pageLinks)
    .innerJoin(pages, eq(pages.id, pageLinks.toPage))
    .where(
      and(
        eq(pageLinks.fromPage, node.id),
        eq(pageLinks.rel, `${node.tier}.${parent}`),
        eq(pages.type, parent),
        ne(pages.status, 'retired'),
      ),
    )
    .orderBy(asc(pageLinks.position), asc(pages.id))
    .limit(1);
  return row === undefined ? null : cascadeNode(db, row.id);
}

export async function cascadeChainOf(
  db: Executor,
  entities: readonly Placed[],
): Promise<readonly CascadeLink[]> {
  let node: CascadeNode | null = null;
  for (const entity of entities) {
    node = node ?? (await placementOf(db, entity));
  }
  const chain: CascadeLink[] = [];
  while (node !== null && chain.length < cascadeTierSchema.options.length) {
    chain.push({ tier: node.tier, pageId: node.id });
    node = await parentNode(db, node);
  }
  return chain;
}
