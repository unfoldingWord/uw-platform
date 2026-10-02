import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMigratedDatabase, query, testServer } from './test-database.ts';

const missingFolder = new URL('./fixtures/no-such-migrations', import.meta.url).pathname;

async function exists(server: string, name: string): Promise<boolean> {
  const rows = await query<{ datname: string }>(
    server,
    `SELECT datname FROM pg_database WHERE datname = '${name}'`,
  );
  return rows.length > 0;
}

describe.skipIf(!testServer)('DX-6 a test database that fails to migrate', () => {
  it('is dropped, and the migration error reaches the caller', async () => {
    const server = testServer ?? '';
    const name = `uw_test_${randomBytes(6).toString('hex')}`;
    await expect(createMigratedDatabase(server, { folder: missingFolder, name })).rejects.toThrow();
    expect(await exists(server, name)).toBe(false);
  });
});
