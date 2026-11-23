import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { CascadeTier, JdArea, PlacedEntityKind } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { cascadePlacements, harnessItems, harnesses, pages, tasks } from '@uw/db/schema';
import { liveNode, node, ownTier, placedAs } from './counts.ts';

export type CellEntity = {
  readonly kind: PlacedEntityKind;
  readonly id: string;
  readonly title: string;
  readonly harnessId: string | null;
  readonly node: string | null;
};

export type CellTier = CascadeTier | 'unplaced';

const MOST = 200;

function tierIs(column: SQL | typeof node.type, tier: CellTier): SQL {
  return tier === 'unplaced' ? isNull(column) : sql`${column} = ${tier}`;
}

async function cellPages(db: Executor, area: JdArea, tier: CellTier): Promise<CellEntity[]> {
  const rows = await db
    .select({ id: pages.id, title: pages.title, node: node.title })
    .from(pages)
    .leftJoin(cascadePlacements, placedAs('page', pages.id))
    .leftJoin(node, liveNode)
    .where(and(eq(pages.jdArea, area), ne(pages.status, 'retired'), tierIs(ownTier, tier)))
    .orderBy(asc(pages.title))
    .limit(MOST);
  return rows.map((row) => ({ kind: 'page', harnessId: null, ...row }));
}

async function cellTasks(db: Executor, area: JdArea, tier: CellTier): Promise<CellEntity[]> {
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, node: node.title })
    .from(tasks)
    .leftJoin(cascadePlacements, placedAs('task', sql`${tasks.id}`))
    .leftJoin(node, liveNode)
    .where(and(eq(tasks.jdArea, area), tierIs(node.type, tier)))
    .orderBy(asc(tasks.title))
    .limit(MOST);
  return rows.map((row) => ({ kind: 'task', harnessId: null, ...row }));
}

async function cellItems(db: Executor, area: JdArea, tier: CellTier): Promise<CellEntity[]> {
  const rows = await db
    .select({
      id: harnessItems.id,
      title: harnessItems.title,
      harnessId: harnessItems.harnessId,
      node: node.title,
    })
    .from(harnessItems)
    .innerJoin(harnesses, eq(harnesses.id, harnessItems.harnessId))
    .leftJoin(cascadePlacements, placedAs('item', sql`${harnessItems.id}`))
    .leftJoin(node, liveNode)
    .where(and(eq(harnesses.jdArea, area), tierIs(node.type, tier)))
    .orderBy(asc(harnessItems.title))
    .limit(MOST);
  return rows.map((row) => ({ kind: 'item', ...row }));
}

export async function cellEntities(
  db: Executor,
  actor: Principal,
  area: JdArea,
  tier: CellTier,
  at: Date,
): Promise<readonly CellEntity[] | null> {
  if (!can(actor, 'read', { kind: 'area', area }, at)) return null;
  const found = await Promise.all([
    cellPages(db, area, tier),
    cellTasks(db, area, tier),
    cellItems(db, area, tier),
  ]);
  return found.flat();
}
