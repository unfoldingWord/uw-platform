import { asc, eq, inArray } from 'drizzle-orm';
import {
  collectionDefinitionSchema,
  definitionProblems,
  propertyDefinitionSchema,
  type CollectionDefinition,
  type CollectionSummary,
  type PropertyDefinition,
} from '@uw/contracts';
import { readableAreas } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor, Transaction } from '@uw/db/client';
import { collectionProperties, collections, collectionVersions } from '@uw/db/schema';

export type StoredCollection = {
  readonly id: string;
  readonly version: number;
  readonly definition: CollectionDefinition;
  readonly propertyIds: ReadonlyMap<string, string>;
};

type CollectionRow = typeof collections.$inferSelect;
type PropertyRow = typeof collectionProperties.$inferSelect;

function assemble(row: CollectionRow, properties: readonly PropertyRow[]): StoredCollection {
  const definition = collectionDefinitionSchema.parse({
    key: row.key,
    name: row.name,
    jdArea: row.jdArea,
    rowSource: row.rowSource,
    pageType: row.pageType,
    description: row.description,
    locked: row.locked,
    properties: properties.map((property) => property.definition),
  });
  const propertyIds = new Map(properties.map((property) => [property.key, property.id]));
  return { id: row.id, version: row.version, definition, propertyIds };
}

async function propertiesOf(db: Executor, ids: readonly string[]): Promise<PropertyRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(collectionProperties)
    .where(inArray(collectionProperties.collectionId, [...ids]))
    .orderBy(asc(collectionProperties.position));
}

async function assembled(
  db: Executor,
  rows: readonly CollectionRow[],
): Promise<StoredCollection[]> {
  const properties = await propertiesOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    assemble(
      row,
      properties.filter((property) => property.collectionId === row.id),
    ),
  );
}

export async function loadCollection(db: Executor, key: string): Promise<StoredCollection | null> {
  const rows = await db.select().from(collections).where(eq(collections.key, key));
  const [found] = await assembled(db, rows);
  return found ?? null;
}

export async function lockedCollection(
  tx: Transaction,
  key: string,
): Promise<StoredCollection | null> {
  const rows = await tx.select().from(collections).where(eq(collections.key, key)).for('update');
  const [found] = await assembled(tx, rows);
  return found ?? null;
}

export async function loadCollectionById(
  db: Executor,
  id: string,
): Promise<StoredCollection | null> {
  const rows = await db.select().from(collections).where(eq(collections.id, id));
  const [found] = await assembled(db, rows);
  return found ?? null;
}

export async function allCollections(db: Executor): Promise<StoredCollection[]> {
  const rows = await db.select().from(collections).orderBy(asc(collections.key));
  return assembled(db, rows);
}

export function summaryOf(stored: StoredCollection): CollectionSummary {
  const { key, name, jdArea, locked } = stored.definition;
  return { key, name, jdArea, version: stored.version, locked };
}

export async function readableCollections(
  db: Executor,
  actor: Principal,
  at: Date,
): Promise<StoredCollection[]> {
  const readable = readableAreas(actor, at);
  const every = await allCollections(db);
  if (readable.kind === 'all') return every;
  return every.filter((stored) => readable.areas.includes(stored.definition.jdArea));
}

export async function problemsWith(
  db: Executor,
  definition: CollectionDefinition,
): Promise<readonly string[]> {
  const known = new Map((await allCollections(db)).map((s) => [s.definition.key, s.definition]));
  known.set(definition.key, definition);
  return definitionProblems(definition, (key) => known.get(key)).map(
    (found) => `${found.property}: ${found.problem}`,
  );
}

async function writeProperties(
  tx: Transaction,
  collectionId: string,
  properties: readonly PropertyDefinition[],
): Promise<void> {
  const keep = properties.map((property) => property.key);
  const stored = await tx
    .select({ id: collectionProperties.id, key: collectionProperties.key })
    .from(collectionProperties)
    .where(eq(collectionProperties.collectionId, collectionId));
  const gone = stored.filter((row) => !keep.includes(row.key)).map((row) => row.id);
  if (gone.length > 0)
    await tx.delete(collectionProperties).where(inArray(collectionProperties.id, gone));
  for (const [position, property] of properties.entries()) {
    const row = {
      collectionId,
      key: property.key,
      type: property.config.type,
      classification: property.classification,
      position,
      definition: propertyDefinitionSchema.parse(property),
    };
    await tx
      .insert(collectionProperties)
      .values(row)
      .onConflictDoUpdate({
        target: [collectionProperties.collectionId, collectionProperties.key],
        set: {
          type: row.type,
          classification: row.classification,
          position,
          definition: row.definition,
        },
      });
  }
}

export async function insertCollection(
  tx: Transaction,
  id: string,
  definition: CollectionDefinition,
  actor: Principal,
): Promise<void> {
  await tx.insert(collections).values({
    id,
    key: definition.key,
    name: definition.name,
    jdArea: definition.jdArea,
    rowSource: definition.rowSource,
    pageType: definition.pageType,
    description: definition.description,
    locked: definition.locked,
    version: 1,
    createdBy: actor.identity,
  });
  await writeProperties(tx, id, definition.properties);
  await tx
    .insert(collectionVersions)
    .values({ collectionId: id, version: 1, definition, savedBy: actor.identity });
}

export async function saveDefinition(
  tx: Transaction,
  stored: StoredCollection,
  next: CollectionDefinition,
  change: { readonly actor: Principal; readonly at: Date },
): Promise<number> {
  const { actor, at } = change;
  const version = stored.version + 1;
  await tx
    .update(collections)
    .set({
      name: next.name,
      description: next.description,
      locked: next.locked,
      version,
      updatedAt: at,
    })
    .where(eq(collections.id, stored.id));
  await writeProperties(tx, stored.id, next.properties);
  await tx
    .insert(collectionVersions)
    .values({ collectionId: stored.id, version, definition: next, savedBy: actor.identity });
  return version;
}
