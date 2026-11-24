import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { CascadeTier, JdArea, PlacedEntityKind } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { cascadePlacements, harnessItems, harnesses, pages, tasks } from '@uw/db/schema';
import { MIRRORED, liveNode, node, ownTier, placedAs } from './counts.ts';

export type CellEntity = {
  readonly kind: PlacedEntityKind;
  readonly id: string;
  readonly title: string;
  readonly harnessId: string | null;
  readonly node: string | null;
  readonly nodeId: string | null;
};

type Row = Omit<CellEntity, 'kind' | 'harnessId'> & {
  readonly harnessId?: string;
  readonly nodeArea: string | null;
};

const placedUnder = { node: node.title, nodeId: node.id, nodeArea: node.jdArea };

export type CellTier = CascadeTier | 'unplaced';

const MOST = 200;

function tierIs(column: SQL | typeof node.type, tier: CellTier): SQL {
  return tier === 'unplaced' ? isNull(column) : sql`${column} = ${tier}`;
}

async function cellPages(db: Executor, area: JdArea, tier: CellTier): Promise<Row[]> {
  const rows = await db
    .select({ id: pages.id, title: pages.title, ...placedUnder })
    .from(pages)
    .leftJoin(cascadePlacements, placedAs('page', pages.id))
    .leftJoin(node, liveNode)
    .where(
      and(
        eq(pages.jdArea, area),
        ne(pages.status, 'retired'),
        ne(pages.type, MIRRORED),
        tierIs(ownTier, tier),
      ),
    )
    .orderBy(asc(pages.title))
    .limit(MOST);
  return rows;
}

async function cellTasks(db: Executor, area: JdArea, tier: CellTier): Promise<Row[]> {
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, ...placedUnder })
    .from(tasks)
    .leftJoin(cascadePlacements, placedAs('task', sql`${tasks.id}`))
    .leftJoin(node, liveNode)
    .where(and(eq(tasks.jdArea, area), tierIs(node.type, tier)))
    .orderBy(asc(tasks.title))
    .limit(MOST);
  return rows;
}

async function cellItems(db: Executor, area: JdArea, tier: CellTier): Promise<Row[]> {
  const rows = await db
    .select({
      id: harnessItems.id,
      title: harnessItems.title,
      harnessId: harnessItems.harnessId,
      ...placedUnder,
    })
    .from(harnessItems)
    .innerJoin(harnesses, eq(harnesses.id, harnessItems.harnessId))
    .leftJoin(cascadePlacements, placedAs('item', sql`${harnessItems.id}`))
    .leftJoin(node, liveNode)
    .where(and(eq(harnesses.jdArea, area), tierIs(node.type, tier)))
    .orderBy(asc(harnessItems.title))
    .limit(MOST);
  return rows;
}

export async function cellEntities(
  db: Executor,
  actor: Principal,
  area: JdArea,
  tier: CellTier,
  at: Date,
): Promise<readonly CellEntity[] | null> {
  if (!can(actor, 'read', { kind: 'area', area }, at)) return null;
  const [found, listed, held] = await Promise.all([
    cellPages(db, area, tier),
    cellTasks(db, area, tier),
    cellItems(db, area, tier),
  ]);
  const shown =
    (kind: PlacedEntityKind) =>
    (row: Row): CellEntity => {
      const readable =
        row.nodeArea !== null && can(actor, 'read', { kind: 'area', area: row.nodeArea }, at);
      return {
        kind,
        id: row.id,
        title: row.title,
        harnessId: row.harnessId ?? null,
        node: readable ? row.node : null,
        nodeId: readable ? row.nodeId : null,
      };
    };
  return [...found.map(shown('page')), ...listed.map(shown('task')), ...held.map(shown('item'))];
}
