import { afterAll } from 'vitest';
import { closeEmbeddedTemplate, createEmbeddedDatabase } from '@uw/db/embedded';
import { revokeSeededGrant, seedGrant, seedPerson } from '@uw/db/test-seed';
import { describeGrantsContract } from '@uw/harness/port-contracts/grants';
import { createSimGrants } from './grants.ts';
import { createSimStore } from './store.ts';

afterAll(closeEmbeddedTemplate);

describeGrantsContract('the embedded Postgres grants', async () => {
  const database = await createEmbeddedDatabase();
  return {
    grants: createSimGrants(database),
    store: createSimStore(database),
    seedPerson: (id) => seedPerson(database.db, { id, email: `${id}@fixture.unfoldingword.org` }),
    seedGrant: (grant) => seedGrant(database.db, grant),
    revoke: (id, at) => revokeSeededGrant(database.db, id, at),
    close: () => database.close(),
  };
});
