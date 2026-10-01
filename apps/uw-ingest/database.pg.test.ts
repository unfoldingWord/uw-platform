import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';

describe.skipIf(!testServer)('FD-6 uw-ingest reaches the migrated test database', () => {
  it('runs a query against a database with every migration applied', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        const rows = await db.execute<{ answer: number }>(sql`SELECT 1 AS answer`);
        expect([...rows]).toEqual([{ answer: 1 }]);
      } finally {
        await db.$client.end();
      }
    }));
});
