import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { createMigratedDatabase } from '@uw/db/test-database';
import { seedPerson } from '@uw/db/test-seed';
import { testServer } from '../../testing/postgres.ts';
import { pushStore } from './store.ts';

const at = new Date('2026-10-04T09:00:00.000Z');
const trials = 8;

function personId(n: number): string {
  return `c6200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

describe.skipIf(!testServer)('the cooldown claim across connections', () => {
  it('two wakes for one person on two connections claim the window once', async () => {
    const database = await createMigratedDatabase(testServer ?? '');
    const first = createClient(database.connectionString);
    const second = createClient(database.connectionString);
    try {
      for (let n = 0; n < trials; n += 1) {
        await seedPerson(first, { id: personId(n), email: `race-${n}@unfoldingword.org` });
      }
      const claims = await Promise.all(
        Array.from({ length: trials }, (_, n) =>
          Promise.all([
            pushStore(first).claimWindow(personId(n), 3, at),
            pushStore(second).claimWindow(personId(n), 3, at),
          ]),
        ),
      );
      for (const pair of claims) {
        expect(pair.filter(Boolean)).toHaveLength(1);
      }
    } finally {
      await first.$client.end();
      await second.$client.end();
      await database.drop();
    }
  });
});
