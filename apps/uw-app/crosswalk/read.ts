import { and, asc, eq } from 'drizzle-orm';
import {
  cascadeNodeReplySchema,
  crosswalkReplySchema,
  mapRelationSchema,
  type CascadeNodeReply,
  type CascadeTier,
  type CrosswalkReply,
  type EntityCounts,
  type JdArea,
  type MapLink,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { jdCascadeMap, pages } from '@uw/db/schema';
import { entityCounts, nodeCounts, type CountRow } from './counts.ts';
import { cascadeNode, isNode, tiers } from './nodes.ts';
import { areasRead, readFilter } from './scope.ts';

export type AreaLink = MapLink & { readonly jdArea: JdArea; readonly tier: CascadeTier };

const none = (): EntityCounts => ({ pages: 0, tasks: 0, items: 0 });

const field = { page: 'pages', task: 'tasks', item: 'items' } as const;

export async function mapLinks(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<readonly AreaLink[]> {
  const areas = readFilter(actor, at, jdCascadeMap.jdArea);
  if (areas === null) return [];
  const rows = await db
    .select({
      mapId: jdCascadeMap.id,
      jdArea: jdCascadeMap.jdArea,
      cascadePageId: jdCascadeMap.cascadePageId,
      relation: jdCascadeMap.relation,
      note: jdCascadeMap.note,
      title: pages.title,
      tier: pages.type,
    })
    .from(jdCascadeMap)
    .innerJoin(pages, eq(pages.id, jdCascadeMap.cascadePageId))
    .where(and(isNode, areas))
    .orderBy(asc(jdCascadeMap.jdArea), asc(pages.title), asc(jdCascadeMap.relation));
  return rows.map((row) => ({
    ...row,
    relation: mapRelationSchema.parse(row.relation),
    tier: row.tier as CascadeTier,
  }));
}

function tally(rows: readonly CountRow[], area: string, tier: string | null): EntityCounts {
  const counts = none();
  for (const row of rows) {
    if (row.area === area && row.tier === tier) counts[field[row.kind]] += row.count;
  }
  return counts;
}

export async function crosswalk(db: Executor, actor: Principal, at: Date): Promise<CrosswalkReply> {
  const [counted, links] = await Promise.all([
    entityCounts(db, actor, at),
    mapLinks(db, actor, at),
  ]);
  const rows = areasRead(actor, at).map((jdArea) => ({
    jdArea,
    cells: tiers.map((tier) => ({
      tier,
      counts: tally(counted, jdArea, tier),
      links: links
        .filter((link) => link.jdArea === jdArea && link.tier === tier)
        .map(({ mapId, cascadePageId, title, relation, note }) => ({
          mapId,
          cascadePageId,
          title,
          relation,
          note,
        })),
    })),
    unplaced: tally(counted, jdArea, null),
  }));
  return crosswalkReplySchema.parse({ tiers: [...tiers], rows });
}

function placedUnder(rows: readonly CountRow[], area: string): EntityCounts {
  const counts = none();
  for (const row of rows) if (row.area === area) counts[field[row.kind]] += row.count;
  return counts;
}

export async function cascadeNodeView(
  db: Executor,
  actor: Principal,
  id: string,
  at: Date,
): Promise<CascadeNodeReply | null> {
  const node = await cascadeNode(db, id);
  if (node === null || !can(actor, 'read', { kind: 'area', area: node.jdArea }, at)) return null;
  const [counted, links] = await Promise.all([
    nodeCounts(db, actor, id, at),
    mapLinks(db, actor, at),
  ]);
  const mine = links.filter((link) => link.cascadePageId === id);
  const areas = areasRead(actor, at)
    .map((jdArea) => ({
      jdArea,
      counts: placedUnder(counted, jdArea),
      links: mine
        .filter((link) => link.jdArea === jdArea)
        .map(({ mapId, cascadePageId, title, relation, note }) => ({
          mapId,
          cascadePageId,
          title,
          relation,
          note,
        })),
    }))
    .filter((area) => area.links.length > 0 || total(area.counts) > 0);
  return cascadeNodeReplySchema.parse({
    cascadePageId: node.id,
    title: node.title,
    tier: node.tier,
    areas,
  });
}

function total(counts: EntityCounts): number {
  return counts.pages + counts.tasks + counts.items;
}
