import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient } from './client.ts';
import { testServer, withEmptyDatabase } from './test-database.ts';

describe.skipIf(!testServer)('the uw-app client factory against a real Postgres', () => {
  it('connects with a connection string and runs a query', () =>
    withEmptyDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        const rows = await db.execute<{ answer: number }>(sql`SELECT 1 AS answer`);
        expect([...rows]).toEqual([{ answer: 1 }]);
      } finally {
        await db.$client.end();
      }
    }));
});
