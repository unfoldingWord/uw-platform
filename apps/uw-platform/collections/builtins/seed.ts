import { eq } from 'drizzle-orm';
import {
  collectionDefinitionSchema,
  definitionProblems,
  viewSettingsSchema,
  type CollectionDefinition,
} from '@uw/contracts';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import type { Database, Transaction } from '@uw/db/client';
import { collections, collectionTemplates } from '@uw/db/schema';
import { allCollections, insertCollection, loadCollection } from '../definitions.ts';
import { seedAreaHome } from '../../pages/area-homes.ts';
import { writeView } from '../view-rows.ts';
import { dashboardHome } from './dashboard.ts';
import { directoryCollection } from './directory.ts';
import { resourcesCollection } from './resources.ts';
import type { BuiltIn } from './seed-types.ts';
import {
  okrCollection,
  portfolioCollection,
  programCollection,
  projectCollection,
} from './strategy.ts';
import { tasksCollection } from './tasks.ts';

const BUILT_IN_AUTHOR = 'agent:built-in';

export const builtIns: readonly BuiltIn[] = [
  portfolioCollection,
  okrCollection,
  programCollection,
  projectCollection,
  tasksCollection,
  directoryCollection,
  resourcesCollection,
];

function builtInDefinitions(): readonly CollectionDefinition[] {
  return builtIns.map((built) => collectionDefinitionSchema.parse(built.definition));
}

export function builtInProblems(): readonly string[] {
  const definitions = builtInDefinitions();
  const byKey = new Map(definitions.map((d) => [d.key, d]));
  return definitions.flatMap((definition) =>
    definitionProblems(definition, (key) => byKey.get(key)).map(
      (found) => `${definition.key}.${found.property}: ${found.problem}`,
    ),
  );
}

async function seedOne(tx: Transaction, built: BuiltIn, at: Date): Promise<void> {
  const definition = collectionDefinitionSchema.parse(built.definition);
  await insertCollection(tx, built.id, definition, BUILT_IN_AUTHOR);
  for (const template of built.templates ?? []) {
    const { id, name, values, bodyMd } = template;
    await tx
      .insert(collectionTemplates)
      .values({ id, collectionId: built.id, name, values, bodyMd, position: 0 });
  }
  const stored = await loadCollection(tx, definition.key);
  if (stored === null) throw new Error('a seeded collection reads back');
  for (const [position, view] of built.views.entries()) {
    const settings = viewSettingsSchema.parse(view.settings);
    await writeView(tx, stored, { viewId: view.id, ownerId: null, position, settings, at });
  }
}

export async function ensureBuiltIns(db: Database, at: Date): Promise<void> {
  const present = new Set(
    (await db.select({ key: collections.key }).from(collections)).map((r) => r.key),
  );
  const missing = builtIns.filter(
    (built) => !present.has(collectionDefinitionSchema.parse(built.definition).key),
  );
  if (missing.length === 0) return;
  await db.transaction(async (tx) => {
    await tx.execute(advisoryLock(advisoryLocks.builtInCollections));
    const known = new Set((await allCollections(tx)).map((s) => s.definition.key));
    for (const built of missing) {
      const key = collectionDefinitionSchema.parse(built.definition).key;
      const taken = await tx
        .select({ id: collections.id })
        .from(collections)
        .where(eq(collections.id, built.id));
      if (!known.has(key) && taken.length === 0) await seedOne(tx, built, at);
    }
    await seedAreaHome(tx, dashboardHome, BUILT_IN_AUTHOR, at);
  });
}
