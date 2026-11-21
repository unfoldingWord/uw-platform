import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { and, eq, inArray } from 'drizzle-orm';
import {
  rowQuerySchema,
  type DeleteViewCommand,
  type MoveCardCommand,
  type SaveTemplateCommand,
  type SaveViewCommand,
  type RowsReply,
  type SavedView,
  type SetPropertyCommand,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { collectionCardOrder, collectionTemplates } from '@uw/db/schema';
import type { Request } from './definition-commands.ts';
import { loadCollection, loadCollectionById, type StoredCollection } from './definitions.ts';
import { refusal, type CollectionOutcome, type Done } from './outcome.ts';
import { planOf } from './query/run.ts';
import { mayReadCollection, readRow, readRows, scopeOf } from './reader.ts';
import { settle } from './requests.ts';
import { setPropertyIn } from './rows.ts';
import { groupValue } from './group-values.ts';
import { deleteViewRow, nextViewPosition, viewById, viewRow, writeView } from './view-rows.ts';

function mayShape(
  actor: Principal,
  stored: StoredCollection,
  ownerId: string | null,
  at: Date,
): boolean {
  const area = { kind: 'area', area: stored.definition.jdArea } as const;
  if (ownerId === null) return can(actor, 'write', area, at);
  return actor.kind === 'person' && actor.personId === ownerId && can(actor, 'read', area, at);
}

function mayReplace(
  existing: Awaited<ReturnType<typeof viewRow>>,
  stored: StoredCollection,
  ownerId: string | null,
): boolean {
  return existing === null || (existing.collectionId === stored.id && existing.ownerId === ownerId);
}

export function saveView(
  db: Database,
  command: SaveViewCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const stored = await loadCollection(tx, command.collection);
    if (stored === null || !mayReadCollection(stored, request.actor, request.at))
      return refusal('collection_not_found');
    const ownerId = command.settings.scope === 'personal' ? request.actor.personId : null;
    const existing = await viewRow(tx, command.viewId);
    if (
      !mayReplace(existing, stored, ownerId) ||
      !mayShape(request.actor, stored, ownerId, request.at)
    ) {
      return refusal('not_permitted');
    }
    const scope = await scopeOf(tx, stored, request.actor, request.at);
    const { filter, sorts, group } = command.settings;
    const plan = planOf(scope, rowQuerySchema.parse({ filter, sorts, group }));
    if (!plan.ok) return refusal(plan.reason);
    const position = existing?.position ?? (await nextViewPosition(tx, stored));
    await writeView(tx, stored, {
      viewId: command.viewId,
      ownerId,
      position,
      settings: command.settings,
      at: request.at,
    });
    return {
      ok: true,
      collection: stored.definition.key,
      version: stored.version,
      viewId: command.viewId,
    };
  });
}

export function deleteView(
  db: Database,
  command: DeleteViewCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const row = await viewRow(tx, command.viewId);
    if (row === null) return refusal('view_not_found');
    const stored = await loadCollectionById(tx, row.collectionId);
    if (stored === null || !mayShape(request.actor, stored, row.ownerId, request.at))
      return refusal('not_permitted');
    await deleteViewRow(tx, row.id);
    return { ok: true, collection: stored.definition.key, version: stored.version, viewId: row.id };
  });
}

async function positionsOf(tx: Transaction, viewId: string, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await tx
    .select()
    .from(collectionCardOrder)
    .where(
      and(eq(collectionCardOrder.viewId, viewId), inArray(collectionCardOrder.rowId, [...ids])),
    );
  return new Map(rows.map((row) => [row.rowId, row.position]));
}

async function putPosition(tx: Transaction, viewId: string, rowId: string, position: string) {
  await tx
    .insert(collectionCardOrder)
    .values({ viewId, rowId, position })
    .onConflictDoUpdate({
      target: [collectionCardOrder.viewId, collectionCardOrder.rowId],
      set: { position },
    });
}

function isKey(position: string): boolean {
  try {
    generateKeyBetween(position, null);
    return true;
  } catch {
    return false;
  }
}

async function keyedGroup(tx: Transaction, viewId: string, ordered: readonly string[]) {
  const known = await positionsOf(tx, viewId, ordered);
  const whole = ordered.every((id) => isKey(known.get(id) ?? ''));
  if (whole) return known;
  const keys = generateNKeysBetween(null, null, ordered.length);
  const keyed = new Map<string, string>();
  for (const [index, id] of ordered.entries()) {
    const key = keys.at(index) ?? generateKeyBetween(null, null);
    keyed.set(id, key);
    await putPosition(tx, viewId, id, key);
  }
  return keyed;
}

async function placeCard(tx: Transaction, command: MoveCardCommand, shown: readonly string[]) {
  const others = shown.filter((id) => id !== command.rowId);
  const keys = await keyedGroup(tx, command.viewId, others);
  const low = command.after === null ? null : (keys.get(command.after) ?? null);
  const high = command.before === null ? null : (keys.get(command.before) ?? null);
  const ordered = low === null || high === null || low < high;
  const position = ordered ? generateKeyBetween(low, high) : generateKeyBetween(low, null);
  await putPosition(tx, command.viewId, command.rowId, position);
}

function overLimit(reply: RowsReply, command: MoveCardCommand, limit: number): boolean {
  const inGroup = reply.rows.filter((row) => row.group === command.group);
  if (inGroup.some((row) => row.id === command.rowId)) return false;
  const count = reply.groups?.find((g) => g.value === command.group)?.count ?? inGroup.length;
  return count >= limit;
}

async function wipRefusal(
  tx: Transaction,
  stored: StoredCollection,
  view: SavedView,
  command: MoveCardCommand,
  request: Request,
): Promise<Done | null> {
  const limit = view.settings.groups.find((g) => g.value === command.group)?.wipLimit ?? null;
  if (limit === null || command.group === null) return null;
  const { filter, group } = view.settings;
  const read = await readRows(tx, stored, request.actor, request.at, {
    query: rowQuerySchema.parse({ filter, group, limit: 200 }),
    view,
  });
  if (!read.ok) return refusal(read.reason);
  return overLimit(read.value, command, limit) ? refusal('wip_limit_reached') : null;
}

async function regroup(
  tx: Transaction,
  stored: StoredCollection,
  view: SavedView,
  command: MoveCardCommand,
  request: Request,
): Promise<Done> {
  const grouping = view.settings.group;
  if (grouping === null || command.group === null)
    return {
      ok: true,
      collection: stored.definition.key,
      version: stored.version,
      rowId: command.rowId,
    };
  const blocked = await wipRefusal(tx, stored, view, command, request);
  if (blocked !== null) return blocked;
  const property = stored.definition.properties.find((p) => p.key === grouping.property);
  if (property === undefined) return refusal('property_not_found');
  const now = await readRow(tx, stored, request.actor, request.at, { id: command.rowId, grouping });
  if (now === null) return refusal('row_not_found');
  if (now.group === command.group)
    return {
      ok: true,
      collection: stored.definition.key,
      version: now.version ?? 1,
      rowId: command.rowId,
    };
  const value = groupValue(property, grouping.by, command.group) as
    SetPropertyCommand['value'] | undefined;
  if (value === undefined) return refusal('invalid_value');
  const set = {
    command: 'set_property',
    requestId: command.requestId,
    collection: stored.definition.key,
    rowId: command.rowId,
    property: property.key,
    value,
  } as const;
  return setPropertyIn(tx, stored, set, request);
}

type Move = { readonly stored: StoredCollection; readonly view: SavedView };

async function movable(
  tx: Transaction,
  command: MoveCardCommand,
  request: Request,
): Promise<Move | Done> {
  const row = await viewRow(tx, command.viewId);
  const stored = row === null ? null : await loadCollectionById(tx, row.collectionId);
  if (stored === null || !mayReadCollection(stored, request.actor, request.at)) {
    return refusal('view_not_found');
  }
  const view = await viewById(tx, stored, command.viewId);
  if (view === null || (view.ownerId !== null && view.ownerId !== request.actor.personId)) {
    return refusal('view_not_found');
  }
  return { stored, view };
}

async function shownInGroup(tx: Transaction, move: Move, group: string | null, request: Request) {
  const { filter, sorts, group: grouping } = move.view.settings;
  const read = await readRows(tx, move.stored, request.actor, request.at, {
    query: rowQuerySchema.parse({ filter, sorts, group: grouping, limit: 200 }),
    view: move.view,
  });
  if (!read.ok) return [];
  return read.value.rows.filter((row) => row.group === group).map((row) => row.id);
}

async function moveRefusal(
  tx: Transaction,
  move: Move,
  command: MoveCardCommand,
  request: Request,
) {
  const grouping = move.view.settings.group;
  const moved = await readRow(tx, move.stored, request.actor, request.at, {
    id: command.rowId,
    grouping,
  });
  if (moved === null) return { refused: refusal('row_not_found'), moved: null };
  const own = move.view.ownerId !== null && move.view.ownerId === request.actor.personId;
  const area = moved.jdArea;
  const writable = area !== null && can(request.actor, 'write', { kind: 'area', area }, request.at);
  if (!own && !writable) return { refused: refusal('not_permitted'), moved: null };
  for (const neighbour of [command.after, command.before]) {
    if (neighbour === null) continue;
    if ((await readRow(tx, move.stored, request.actor, request.at, neighbour)) === null) {
      return { refused: refusal('row_not_found'), moved: null };
    }
  }
  return { refused: null, moved };
}

export function moveCard(
  db: Database,
  command: MoveCardCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const move = await movable(tx, command, request);
    if ('ok' in move) return move;
    const { refused, moved } = await moveRefusal(tx, move, command, request);
    if (refused !== null || moved === null) return refused ?? refusal('row_not_found');
    const done = await regroup(tx, move.stored, move.view, command, request);
    if (!done.ok) return done;
    if (move.view.settings.manualOrder) {
      const shown = await shownInGroup(tx, move, command.group ?? moved.group, request);
      await placeCard(tx, command, shown);
    }
    return { ...done, viewId: move.view.id };
  });
}

export function saveTemplate(
  db: Database,
  command: SaveTemplateCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const stored = await loadCollection(tx, command.collection);
    if (stored === null || !mayReadCollection(stored, request.actor, request.at))
      return refusal('collection_not_found');
    if (!can(request.actor, 'write', { kind: 'area', area: stored.definition.jdArea }, request.at))
      return refusal('not_permitted');
    const unknown = Object.keys(command.values).filter((key) => !stored.propertyIds.has(key));
    if (unknown.length > 0) return refusal('property_not_found');
    const [existing] = await tx
      .select({ collectionId: collectionTemplates.collectionId })
      .from(collectionTemplates)
      .where(eq(collectionTemplates.id, command.templateId));
    if (existing !== undefined && existing.collectionId !== stored.id)
      return refusal('not_permitted');
    const row = { name: command.name, values: command.values, bodyMd: command.bodyMd };
    await tx
      .insert(collectionTemplates)
      .values({ id: command.templateId, collectionId: stored.id, position: 0, ...row })
      .onConflictDoUpdate({ target: collectionTemplates.id, set: row });
    return { ok: true, collection: stored.definition.key, version: stored.version };
  });
}
