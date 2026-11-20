import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { seedGrant, seedHarness, seedPerson } from '@uw/db/test-seed';
import { createCredential } from '../credentials/store.ts';
import {
  harnessId,
  otherHarnessId,
  person,
  seededGrants,
  seededPeople,
  traceId,
  worldOn,
  type World,
} from '../credentials/testing/store-world.ts';

export type PgWorld = World & {
  readonly db: Database;
  created(name: string, value?: string): Promise<string>;
  drop(): Promise<void>;
};

export async function pgWorld(server: string): Promise<PgWorld> {
  const database = await createMigratedDatabase(server);
  const db = createClient(database.connectionString);
  for (const seeded of seededPeople) await seedPerson(db, seeded);
  for (const seeded of seededGrants) await seedGrant(db, seeded);
  await seedHarness(db, { id: harnessId, key: 'finance', jdArea: '20-29' });
  await seedHarness(db, { id: otherHarnessId, key: 'finance-two', jdArea: '20-29' });
  const world = await worldOn(db);
  return {
    ...world,
    db,
    created: async (name, value) => {
      const outcome = await createCredential(
        world.deps,
        person('admin'),
        world.input(name, value),
        traceId,
      );
      if (!outcome.ok) throw new Error(`create was refused: ${outcome.reason}`);
      return outcome.credentialId;
    },
    drop: async () => {
      await db.$client.end();
      await database.drop();
    },
  };
}
