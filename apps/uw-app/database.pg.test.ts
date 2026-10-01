import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { hyperdriveDatabase } from './database.ts';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';

describe.skipIf(!testServer)('FD-6 uw-app reaches the migrated test database', () => {
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

describe.skipIf(!testServer)('FD-11 the database handle', () => {
  it('pings a reachable database and releases its connection', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const handle = hyperdriveDatabase({ HYPERDRIVE: { connectionString: target } });
      await expect(handle?.ping()).resolves.toBeUndefined();
      await handle?.release();
    }));

  it('opens nothing when no Hyperdrive binding is configured', () => {
    expect(hyperdriveDatabase({})).toBeNull();
  });
});
