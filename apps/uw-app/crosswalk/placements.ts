import { and, eq, ne } from 'drizzle-orm';
import type { ErrorReason, PlaceInCascadeCommand, PlacedEntityKind } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor } from '@uw/db/client';
import { cascadePlacements, harnessItems, harnesses, pages, tasks } from '@uw/db/schema';
import type { MapDone } from './map.ts';
import { cascadeNode, tiers } from './nodes.ts';

type Placed = { readonly jdArea: string; readonly isNode: boolean };

const missing: Readonly<Record<PlacedEntityKind, ErrorReason>> = {
  page: 'page_not_found',
  task: 'row_not_found',
  item: 'item_not_found',
};

async function placedPage(db: Executor, id: string): Promise<Placed | null> {
  const [row] = await db
    .select({ jdArea: pages.jdArea, type: pages.type })
    .from(pages)
    .where(and(eq(pages.id, id), ne(pages.status, 'retired')));
  if (row === undefined) return null;
  return { jdArea: row.jdArea, isNode: (tiers as readonly string[]).includes(row.type) };
}

async function placedTask(db: Executor, id: string): Promise<Placed | null> {
  const [row] = await db.select({ jdArea: tasks.jdArea }).from(tasks).where(eq(tasks.id, id));
  return row === undefined ? null : { jdArea: row.jdArea, isNode: false };
}

async function placedItem(db: Executor, id: string): Promise<Placed | null> {
  const [row] = await db
    .select({ jdArea: harnesses.jdArea })
    .from(harnessItems)
    .innerJoin(harnesses, eq(harnesses.id, harnessItems.harnessId))
    .where(eq(harnessItems.id, id));
  return row === undefined ? null : { jdArea: row.jdArea, isNode: false };
}

const finders: Readonly<
  Record<PlacedEntityKind, (db: Executor, id: string) => Promise<Placed | null>>
> = { page: placedPage, task: placedTask, item: placedItem };

export async function placeInCascade(
  db: Database,
  actor: Principal,
  command: PlaceInCascadeCommand,
  at: Date,
): Promise<MapDone> {
  const placed = await finders[command.entityKind](db, command.entityId);
  const area = placed === null ? null : ({ kind: 'area', area: placed.jdArea } as const);
  if (area === null || !can(actor, 'read', area, at)) {
    return { ok: false, reason: missing[command.entityKind] };
  }
  if (!can(actor, 'write', area, at)) return { ok: false, reason: 'not_permitted' };
  if (placed?.isNode === true) return { ok: false, reason: 'invalid_value' };
  const key = and(
    eq(cascadePlacements.entityKind, command.entityKind),
    eq(cascadePlacements.entityId, command.entityId),
  );
  if (command.cascadePageId === null) {
    await db.delete(cascadePlacements).where(key);
    return { ok: true };
  }
  const node = await cascadeNode(db, command.cascadePageId);
  if (node === null || !can(actor, 'read', { kind: 'area', area: node.jdArea }, at)) {
    return { ok: false, reason: 'cascade_node_not_found' };
  }
  const row = {
    entityKind: command.entityKind,
    entityId: command.entityId,
    cascadePageId: node.id,
    placedBy: actor.identity,
    placedAt: at,
  };
  await db
    .insert(cascadePlacements)
    .values(row)
    .onConflictDoUpdate({
      target: [cascadePlacements.entityKind, cascadePlacements.entityId],
      set: { cascadePageId: node.id, placedBy: actor.identity, placedAt: at },
    });
  return { ok: true };
}
