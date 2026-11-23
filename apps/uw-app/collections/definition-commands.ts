import {
  collectionDefinitionSchema,
  convertValue,
  groupableType,
  operatorsByType,
  sortableType,
  propertyDefinitionSchema,
  typeChangeAllowed,
  type AddPropertyCommand,
  type ChangePropertyTypeCommand,
  type CollectionDefinition,
  type CreateCollectionCommand,
  type PropertyDefinition,
  type RemovePropertyCommand,
  type UpdateCollectionCommand,
  type UpdatePropertyCommand,
} from '@uw/contracts';
import { eq } from 'drizzle-orm';
import { can } from '@uw/core/acl';
import { collections } from '@uw/db/schema';
import type { Principal } from '@uw/core/principal';
import type { Database, Transaction } from '@uw/db/client';
import { pagesOfCollection, rewriteFrontmatterKey } from '../pages/collection-pages.ts';
import {
  insertCollection,
  lockedCollection,
  problemsWith,
  saveDefinition,
  type StoredCollection,
} from './definitions.ts';
import { refusal, type CollectionOutcome, type Done } from './outcome.ts';
import { pruneQueries, viewsUsing } from './view-rows.ts';
import { settle } from './requests.ts';

export type Request = {
  readonly actor: Principal;
  readonly traceId: string;
  readonly at: Date;
  readonly newId: () => string;
};

function mayDefine(actor: Principal, area: string, at: Date): boolean {
  return actor.kind === 'person' && can(actor, 'admin', { kind: 'area', area }, at);
}

async function checked(
  tx: Transaction,
  draft: unknown,
): Promise<{ ok: true; definition: CollectionDefinition } | { ok: false; done: Done }> {
  const parsed = collectionDefinitionSchema.safeParse(draft);
  if (!parsed.success)
    return {
      ok: false,
      done: refusal('definition_has_problems', {
        problems: [parsed.error.issues[0]?.message ?? 'invalid'],
      }),
    };
  const problems = await problemsWith(tx, parsed.data);
  if (problems.length > 0)
    return { ok: false, done: refusal('definition_has_problems', { problems }) };
  return { ok: true, definition: parsed.data };
}

async function pageTypeTaken(tx: Transaction, pageType: string | null): Promise<boolean> {
  if (pageType === null || pageType === 'entry') return false;
  const [row] = await tx
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.pageType, pageType));
  return row !== undefined;
}

export function createCollection(
  db: Database,
  command: CreateCollectionCommand,
  request: Request,
): Promise<CollectionOutcome> {
  return settle(
    db,
    request.actor,
    command,
    async (tx) => {
      const { definition } = command;
      if (!mayDefine(request.actor, definition.jdArea, request.at)) return refusal('not_permitted');
      if ((await lockedCollection(tx, definition.key)) !== null)
        return refusal('collection_exists');
      if (await pageTypeTaken(tx, definition.pageType)) return refusal('collection_exists');
      const valid = await checked(tx, definition);
      if (!valid.ok) return valid.done;
      await insertCollection(tx, request.newId(), valid.definition, request.actor.identity);
      return { ok: true, collection: definition.key, version: 1 };
    },
    'collection_exists',
  );
}

type Change = (stored: StoredCollection, tx: Transaction) => Promise<CollectionDefinition | Done>;

function changeDefinition(
  db: Database,
  command: {
    readonly command:
      | CreateCollectionCommand['command']
      | UpdateCollectionCommand['command']
      | AddPropertyCommand['command']
      | UpdatePropertyCommand['command']
      | RemovePropertyCommand['command']
      | ChangePropertyTypeCommand['command'];
    readonly requestId: string;
    readonly collection: string;
  },
  request: Request,
  change: Change,
  unlocking = false,
): Promise<CollectionOutcome> {
  return settle(db, request.actor, command, async (tx) => {
    const stored = await lockedCollection(tx, command.collection);
    if (stored === null) return refusal('collection_not_found');
    if (!mayDefine(request.actor, stored.definition.jdArea, request.at))
      return refusal('not_permitted');
    if (stored.definition.locked && !unlocking) return refusal('collection_locked');
    const next = await change(stored, tx);
    if ('ok' in next) return next;
    const valid = await checked(tx, next);
    if (!valid.ok) return valid.done;
    const version = await saveDefinition(tx, stored, valid.definition, request);
    return { ok: true, collection: stored.definition.key, version };
  });
}

export function updateCollection(db: Database, command: UpdateCollectionCommand, request: Request) {
  return changeDefinition(
    db,
    command,
    request,
    async (stored) => ({
      ...stored.definition,
      name: command.name,
      description: command.description,
      locked: command.locked,
    }),
    true,
  );
}

export function addProperty(db: Database, command: AddPropertyCommand, request: Request) {
  return changeDefinition(db, command, request, async (stored) => {
    if (stored.definition.properties.some((p) => p.key === command.property.key))
      return refusal('property_exists');
    return {
      ...stored.definition,
      properties: [...stored.definition.properties, command.property],
    };
  });
}

function replaced(stored: StoredCollection, property: PropertyDefinition): CollectionDefinition {
  return {
    ...stored.definition,
    properties: stored.definition.properties.map((p) => (p.key === property.key ? property : p)),
  };
}

export function updateProperty(db: Database, command: UpdatePropertyCommand, request: Request) {
  return changeDefinition(db, command, request, async (stored) => {
    const current = stored.definition.properties.find((p) => p.key === command.property.key);
    if (current === undefined) return refusal('property_not_found');
    if (current.config.type !== command.property.config.type)
      return refusal('type_change_not_allowed');
    return replaced(stored, command.property);
  });
}

async function usedByViews(
  tx: Transaction,
  stored: StoredCollection,
  key: string,
): Promise<Done | null> {
  const id = stored.propertyIds.get(key);
  if (id === undefined) return null;
  const uses = await viewsUsing(tx, id);
  if (uses.length === 0) return null;
  return refusal('definition_has_problems', {
    problems: uses.map((use) => `view ${use.view} ${use.role}`),
  });
}

async function pruneFor(tx: Transaction, stored: StoredCollection, property: PropertyDefinition) {
  const id = stored.propertyIds.get(property.key);
  if (id === undefined) return;
  const operators = operatorsByType[property.config.type];
  await pruneQueries(tx, id, { operators, sortable: sortableType(property.config.type) });
}

export function removeProperty(db: Database, command: RemovePropertyCommand, request: Request) {
  return changeDefinition(db, command, request, async (stored, tx) => {
    const current = stored.definition.properties.find((p) => p.key === command.property);
    if (current === undefined) return refusal('property_not_found');
    if (current.config.type === 'title') return refusal('type_change_not_allowed');
    const used = await usedByViews(tx, stored, current.key);
    if (used !== null) return used;
    return {
      ...stored.definition,
      properties: stored.definition.properties.filter((p) => p.key !== command.property),
    };
  });
}

async function convertRows(
  tx: Transaction,
  stored: StoredCollection,
  change: { readonly from: PropertyDefinition; readonly to: PropertyDefinition },
  request: Request,
): Promise<Done | null> {
  const rows = await pagesOfCollection(tx, stored.id);
  const converted = rows.map((page) => ({
    page,
    result: convertValue(change.from, change.to, page.frontmatter[change.from.key] ?? null),
  }));
  const unfit = converted.filter((c) => !c.result.ok).map((c) => c.page.id);
  if (unfit.length > 0) return refusal('rows_do_not_fit', { rows: unfit });
  const source = {
    actor: request.actor,
    traceId: request.traceId,
    requestId: null,
    at: request.at,
  };
  for (const { page, result } of converted) {
    if (!result.ok) continue;
    if (JSON.stringify(result.value) === JSON.stringify(page.frontmatter[change.from.key] ?? null))
      continue;
    await rewriteFrontmatterKey(tx, page, change.from.key, result.value, source);
  }
  return null;
}

export function changePropertyType(
  db: Database,
  command: ChangePropertyTypeCommand,
  request: Request,
) {
  return changeDefinition(db, command, request, async (stored, tx) => {
    const from = stored.definition.properties.find((p) => p.key === command.property);
    if (from === undefined) return refusal('property_not_found');
    const parsed = propertyDefinitionSchema.safeParse({ ...from, config: command.config });
    if (!parsed.success || from.source.kind !== 'frontmatter')
      return refusal('type_change_not_allowed');
    if (!typeChangeAllowed(from.config, command.config)) return refusal('type_change_not_allowed');
    const used = groupableType(parsed.data.config.type)
      ? null
      : await usedByViews(tx, stored, from.key);
    if (used !== null) return used;
    const blocked = await convertRows(tx, stored, { from, to: parsed.data }, request);
    if (blocked !== null) return blocked;
    await pruneFor(tx, stored, parsed.data);
    return replaced(stored, parsed.data);
  });
}
