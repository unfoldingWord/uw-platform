import { describe, expect, it } from 'vitest';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import { hyperdriveDatabase } from './database.ts';

describe.skipIf(!testServer)('FD-11 the database handle', () => {
  it('pings a reachable database and releases its connection', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const handle = hyperdriveDatabase({ HYPERDRIVE: { connectionString: target } });
      try {
        await expect(handle?.ping()).resolves.toBeUndefined();
      } finally {
        await handle?.release();
      }
    }));

  it('opens nothing when no Hyperdrive binding is configured', () => {
    expect(hyperdriveDatabase({})).toBeNull();
  });
});
