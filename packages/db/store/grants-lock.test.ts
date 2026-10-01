import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient } from '../client.ts';
import { pgErrorCode } from '../errors.ts';
import { createMigratedDatabase, testServer } from '../test-database.ts';
import { seedGrant, seedPerson } from '../test-seed.ts';
import { createDrizzleGrants } from './grants.ts';
import { createDrizzleStore } from './store.ts';

const PERSON = 'b1000000-0000-4000-8000-000000000001';
const GRANT = 'b2000000-0000-4000-8000-000000000001';
const LOCK_NOT_AVAILABLE = '55P03';

type Client = ReturnType<typeof createClient>;

async function seedFixture(db: Client): Promise<void> {
  await seedPerson(db, { id: PERSON, email: 'lock@fixture.unfoldingword.org' });
  await seedGrant(db, {
    id: GRANT,
    personId: PERSON,
    role: 'admin',
    scopeKind: 'org',
    scopeArea: null,
    grantedAt: new Date('2029-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
}

function updateWithTimeout(db: Client): Promise<void> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '100ms'`);
    await tx.execute(sql`UPDATE role_grants SET revoked_at = now() WHERE id = ${GRANT}`);
  });
}

async function writerWhileReread(one: Client, two: Client): Promise<unknown> {
  const grants = createDrizzleGrants(one);
  const attempt = createDrizzleStore(one).transaction(async (tx) => {
    await grants.lockAndReread(tx, PERSON, new Date('2030-01-01T00:00:00.000Z'));
    await updateWithTimeout(two);
  });
  return attempt.then(
    () => null,
    (error: unknown) => error,
  );
}

describe.skipIf(!testServer)('DX-6 lockAndReread holds the grant rows against a writer', () => {
  it('makes a second connection time out on updating a reread grant', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const one = createClient(database.connectionString);
    const two = createClient(database.connectionString);
    try {
      await seedFixture(one);
      expect(pgErrorCode(await writerWhileReread(one, two))).toBe(LOCK_NOT_AVAILABLE);
    } finally {
      await one.$client.end();
      await two.$client.end();
      await database.drop();
    }
  });
});
