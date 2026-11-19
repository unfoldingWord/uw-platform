import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { bootstrapAdmin, type FirstAdmin } from './bootstrap-admin.ts';
import { applyMigrations } from './migrate.ts';
import { query, testServer, withEmptyDatabase } from './test-database.ts';

const timeout = 60_000;
const first: FirstAdmin = { email: 'first.admin@unfoldingword.org', displayName: 'First Admin' };
const second: FirstAdmin = { email: 'second.admin@unfoldingword.org', displayName: 'Second' };

async function bootstrap(target: string, admin: FirstAdmin): Promise<void> {
  const connection = postgres(target, { max: 1, onnotice: () => undefined });
  try {
    await bootstrapAdmin((text, params) => connection.unsafe(text, [...params]), admin);
  } finally {
    await connection.end();
  }
}

async function orgAdmins(target: string): Promise<string[]> {
  const rows = await query<{ email: string }>(
    target,
    `SELECT p.email FROM role_grants g JOIN people p ON p.id = g.person_id
     WHERE g.role = 'admin' AND g.scope_kind = 'org' AND g.revoked_at IS NULL ORDER BY 1`,
  );
  return rows.map((row) => row.email);
}

async function bootstrapAudits(target: string): Promise<number> {
  const rows = await query<{ n: number }>(
    target,
    `SELECT count(*)::int AS n FROM grant_audit WHERE action = 'bootstrap'`,
  );
  return Number(rows[0]?.n);
}

describe.skipIf(!testServer)('#124 the first admin comes from a setting', () => {
  it(
    'a fresh database has no person until the bootstrap names one, and then exactly one org admin',
    () =>
      withEmptyDatabase(testServer ?? '', async (target) => {
        await applyMigrations(target);
        expect(await query(target, 'SELECT id FROM people')).toEqual([]);
        await bootstrap(target, first);
        await bootstrap(target, first);
        expect(await orgAdmins(target)).toEqual([first.email]);
        expect(await bootstrapAudits(target)).toBe(1);
      }),
    timeout,
  );

  it(
    'stores an address given with capitals and spaces in lowercase',
    () =>
      withEmptyDatabase(testServer ?? '', async (target) => {
        await applyMigrations(target);
        await bootstrap(target, { ...first, email: ' First.Admin@UnfoldingWord.org ' });
        expect(await orgAdmins(target)).toEqual([first.email]);
      }),
    timeout,
  );

  it(
    'never adds a second org admin once one exists',
    () =>
      withEmptyDatabase(testServer ?? '', async (target) => {
        await applyMigrations(target);
        await bootstrap(target, first);
        await bootstrap(target, second);
        expect(await orgAdmins(target)).toEqual([first.email]);
      }),
    timeout,
  );
});
