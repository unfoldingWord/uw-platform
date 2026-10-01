import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { migrationTimestamps } from '@uw/db/journal';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import { platformKernel } from './kernel.ts';

describe.skipIf(!testServer)('DX-1 the platform kernel on Postgres', () => {
  it('reads health from the platform clock and the Drizzle store', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        const handle = { db, ping: async () => undefined, release: async () => undefined };
        const health = await platformKernel(handle).health();
        expect(health.appliedMigrations).toEqual(migrationTimestamps);
        expect(Math.abs(health.now.getTime() - Date.now())).toBeLessThan(5000);
      } finally {
        await db.$client.end();
      }
    }));
});
