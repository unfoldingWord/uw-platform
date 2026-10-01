import { describe } from 'vitest';
import { createClient } from '@uw/db/client';
import { migrationTimestamps } from '@uw/db/journal';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { describeStoreContract } from '@uw/harness/port-contracts/store';
import { platformStore } from './store.ts';

describe.skipIf(!testServer)('DX-3 the platform store on Postgres', () => {
  describeStoreContract('the Drizzle store over postgres.js', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    return {
      store: platformStore(db),
      expectedMigrations: migrationTimestamps,
      close: async () => {
        await db.$client.end();
        await database.drop();
      },
    };
  });
});
