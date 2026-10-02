import { describe } from 'vitest';
import { createClient } from '@uw/db/client';
import { migrationTimestamps } from '@uw/db/journal';
import { advisoryLocksHeld, lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { seedPage } from '@uw/db/test-seed';
import { describeStoreContract } from '@uw/harness/port-contracts/store';
import { platformStore } from './store.ts';

describe.skipIf(!testServer)('DX-3 the platform store on Postgres', () => {
  describeStoreContract(
    'the Drizzle store over postgres.js',
    async () => {
      const database = await createMigratedDatabase(testServer ?? '');
      const db = createClient(database.connectionString);
      return {
        store: platformStore(db),
        expectedMigrations: migrationTimestamps,
        seedPage: (page) => seedPage(db, page),
        advisoryLocksHeld,
        lockWaiters: () => lockWaiters(db),
        close: async () => {
          await db.$client.end();
          await database.drop();
        },
      };
    },
    { concurrentConnections: true },
  );
});
