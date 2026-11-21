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
import { keyBetween } from './fractional.ts';
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

async function neighbourKeys(tx: Transaction, command: MoveCardCommand) {
  const ids = [command.after, command.before].filter((id): id is string => id !== null);
  const known = await positionsOf(tx, command.viewId, ids);
  let low = command.after === null ? null : (known.get(command.after) ?? null);
  let high = command.before === null ? null : (known.get(command.before) ?? null);
  if (command.after !== null && low === null) {
    low = keyBetween(null, high);
    await putPosition(tx, command.viewId, command.after, low);
  }
  if (command.before !== null && high === null) {
    high = keyBetween(low, null);
    await putPosition(tx, command.viewId, command.before, high);
  }
  return { low, high };
}

async function placeCard(tx: Transaction, command: MoveCardCommand): Promise<void> {
  const { low, high } = await neighbourKeys(tx, command);
  const ordered = low === null || high === null || low < high;
  const position = ordered ? keyBetween(low, high) : keyBetween(low, null);
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

export function moveCard(
  db: Database,
  command: MoveCardCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const row = await viewRow(tx, command.viewId);
    const stored = row === null ? null : await loadCollectionById(tx, row.collectionId);
    if (stored === null || !mayReadCollection(stored, request.actor, request.at))
      return refusal('view_not_found');
    const view = await viewById(tx, stored, command.viewId);
    if (view === null || (view.ownerId !== null && view.ownerId !== request.actor.personId))
      return refusal('view_not_found');
    const done = await regroup(tx, stored, view, command, request);
    if (!done.ok) return done;
    if (view.settings.manualOrder) await placeCard(tx, command);
    return { ...done, viewId: view.id };
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
    const row = {
      collectionId: stored.id,
      name: command.name,
      values: command.values,
      bodyMd: command.bodyMd,
      position: 0,
    };
    await tx
      .insert(collectionTemplates)
      .values({ id: command.templateId, ...row })
      .onConflictDoUpdate({ target: collectionTemplates.id, set: row });
    return { ok: true, collection: stored.definition.key, version: stored.version };
  });
}
