import { describe } from 'vitest';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { describeGrantsContract } from '@uw/harness/port-contracts/grants';
import { platformGrants } from './grants.ts';
import { platformStore } from './store.ts';

describe.skipIf(!testServer)('DX-3 the platform grants on Postgres', () => {
  describeGrantsContract('the Drizzle grants over postgres.js', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const db = createClient(database.connectionString);
    return {
      grants: platformGrants(db),
      store: platformStore(db),
      seedPerson: (id, status) =>
        seedPerson(db, {
          id,
          email: `${id}@fixture.unfoldingword.org`,
          ...(status ? { status } : {}),
        }),
      seedGrant: (grant) => seedGrant(db, grant),
      revoke: (id, at) => revokeSeededGrant(db, id, at),
      close: async () => {
        await db.$client.end();
        await database.drop();
      },
    };
  });
});
