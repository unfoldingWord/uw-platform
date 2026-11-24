import { and, eq, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PlacedEntityKind } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { cascadePlacements, harnessItems, harnesses, pages, tasks } from '@uw/db/schema';
import { tiers } from './nodes.ts';
import { readFilter } from './scope.ts';

export type CountRow = {
  readonly kind: PlacedEntityKind;
  readonly area: string;
  readonly tier: string | null;
  readonly count: number;
};

export const node = alias(pages, 'cascade_node');

export const MIRRORED = 'issue';

export function placedAs(kind: PlacedEntityKind, id: SQL | typeof pages.id) {
  return and(eq(cascadePlacements.entityKind, kind), sql`${cascadePlacements.entityId} = ${id}`);
}

export const liveNode = and(
  eq(node.id, cascadePlacements.cascadePageId),
  ne(node.status, 'retired'),
);

const tierList = sql.raw(tiers.map((tier) => `'${tier}'`).join(', '));

export const ownTier = sql<
  string | null
>`CASE WHEN ${pages.type} IN (${tierList}) THEN ${pages.type} ELSE ${node.type} END`;

type Focus = string | null;

function under(focus: Focus, id: SQL | typeof pages.id): SQL | undefined {
  if (focus === null) return undefined;
  return sql`(${cascadePlacements.cascadePageId} = ${focus} OR ${id} = ${focus})`;
}

async function pageCounts(db: Executor, actor: Principal, at: Date, focus: Focus) {
  const areas = readFilter(actor, at, pages.jdArea);
  if (areas === null) return [];
  const rows = await db
    .select({ area: pages.jdArea, tier: ownTier, count: sql<number>`count(*)::int` })
    .from(pages)
    .leftJoin(cascadePlacements, placedAs('page', pages.id))
    .leftJoin(node, liveNode)
    .where(
      and(ne(pages.status, 'retired'), ne(pages.type, MIRRORED), areas, under(focus, pages.id)),
    )
    .groupBy(pages.jdArea, ownTier);
  return rows.map((row): CountRow => ({ kind: 'page', ...row }));
}

async function taskCounts(db: Executor, actor: Principal, at: Date, focus: Focus) {
  const areas = readFilter(actor, at, tasks.jdArea);
  if (areas === null) return [];
  const rows = await db
    .select({ area: tasks.jdArea, tier: node.type, count: sql<number>`count(*)::int` })
    .from(tasks)
    .leftJoin(cascadePlacements, placedAs('task', sql`${tasks.id}`))
    .leftJoin(node, liveNode)
    .where(and(areas, under(focus, sql`${tasks.id}`)))
    .groupBy(tasks.jdArea, node.type);
  return rows.map((row): CountRow => ({ kind: 'task', ...row }));
}

async function itemCounts(db: Executor, actor: Principal, at: Date, focus: Focus) {
  const areas = readFilter(actor, at, harnesses.jdArea);
  if (areas === null) return [];
  const rows = await db
    .select({ area: harnesses.jdArea, tier: node.type, count: sql<number>`count(*)::int` })
    .from(harnessItems)
    .innerJoin(harnesses, eq(harnesses.id, harnessItems.harnessId))
    .leftJoin(cascadePlacements, placedAs('item', sql`${harnessItems.id}`))
    .leftJoin(node, liveNode)
    .where(and(areas, under(focus, sql`${harnessItems.id}`)))
    .groupBy(harnesses.jdArea, node.type);
  return rows.map((row): CountRow => ({ kind: 'item', ...row }));
}

async function counted(db: Executor, actor: Principal, at: Date, focus: Focus) {
  const found = await Promise.all([
    pageCounts(db, actor, at, focus),
    taskCounts(db, actor, at, focus),
    itemCounts(db, actor, at, focus),
  ]);
  return found.flat();
}

export function entityCounts(db: Executor, actor: Principal, at: Date): Promise<CountRow[]> {
  return counted(db, actor, at, null);
}

export function nodeCounts(db: Executor, actor: Principal, id: string, at: Date) {
  return counted(db, actor, at, id);
}
