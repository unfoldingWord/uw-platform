import { afterAll } from 'vitest';
import { describeStoreContract } from '@uw/harness/port-contracts/store';
import { closeEmbeddedTemplate, createEmbeddedDatabase } from '@uw/db/embedded';
import { migrationTimestamps } from '@uw/db/journal';
import { seedPage } from '@uw/db/test-seed';
import { advisoryLocksHeld } from '@uw/db/store';
import { createSimStore } from './store.ts';

afterAll(closeEmbeddedTemplate);

describeStoreContract(
  'the embedded Postgres store',
  async () => {
    const database = await createEmbeddedDatabase();
    return {
      store: createSimStore(database),
      expectedMigrations: migrationTimestamps,
      seedPage: (page) => seedPage(database.db, page),
      advisoryLocksHeld,
      close: () => database.close(),
    };
  },
  { concurrentConnections: false },
);
