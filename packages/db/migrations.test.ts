import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMigrations, migrationsFolder } from './migrate.ts';
import { query, testServer, withEmptyDatabase } from './test-database.ts';

const orderedFolder = fileURLToPath(new URL('./fixtures/ordered/migrations', import.meta.url));
const timeout = 60_000;

type JournalEntry = { when: number };

function journalOrder(folder: string): number[] {
  const raw = readFileSync(`${folder}/meta/_journal.json`, 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries.map((entry) => entry.when);
}

async function applied(connectionString: string): Promise<number[]> {
  const rows = await query<{ created_at: string }>(
    connectionString,
    'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id',
  );
  return rows.map((row) => Number(row.created_at));
}

async function catalog(connectionString: string): Promise<string[]> {
  const rows = await query<{ entry: string }>(
    connectionString,
    `SELECT table_name || '.' || column_name AS entry FROM information_schema.columns
       WHERE table_schema = 'public'
     UNION ALL
     SELECT conrelid::regclass || ':' || conname FROM pg_constraint
       WHERE connamespace = 'public'::regnamespace
     ORDER BY 1`,
  );
  return rows.map((row) => row.entry);
}

async function applyTwice(connectionString: string, folder: string) {
  await applyMigrations(connectionString, folder);
  const first = {
    applied: await applied(connectionString),
    catalog: await catalog(connectionString),
  };
  await applyMigrations(connectionString, folder);
  const second = {
    applied: await applied(connectionString),
    catalog: await catalog(connectionString),
  };
  return { first, second };
}

async function insertStage(connectionString: string, stage: string): Promise<string> {
  const text = `INSERT INTO probes (id, stage) VALUES (gen_random_uuid(), '${stage}')`;
  return query(connectionString, text).then(
    () => 'inserted',
    (error: { code?: string }) => `refused ${error.code ?? ''}`,
  );
}

async function asRoleWithoutCreateRole(server: string, target: string): Promise<string> {
  const role = `uw_migrator_${randomBytes(4).toString('hex')}`;
  const database = new URL(target).pathname.slice(1);
  await query(server, `CREATE ROLE ${role} LOGIN NOCREATEROLE NOSUPERUSER`);
  await query(
    server,
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uw_app') THEN CREATE ROLE uw_app NOLOGIN; END IF; END $$`,
  );
  await query(server, `GRANT CREATE ON DATABASE "${database}" TO ${role}`);
  await query(target, `GRANT CREATE, USAGE ON SCHEMA public TO ${role}`);
  const asRole = new URL(target);
  asRole.username = role;
  asRole.password = '';
  return asRole.toString();
}

async function dropRole(server: string, connectionString: string): Promise<void> {
  const role = new URL(connectionString).username;
  await query(server, `DROP ROLE IF EXISTS ${role}`);
}

describe.skipIf(!testServer)('migrations against a real Postgres (TEST_DATABASE_URL)', () => {
  const server = testServer ?? '';

  it(
    'applies the committed migrations to an empty database, and re-applying is a no-op',
    { timeout },
    () =>
      withEmptyDatabase(server, async (target) => {
        const { first, second } = await applyTwice(target, migrationsFolder);
        expect(first.applied).toEqual(journalOrder(migrationsFolder));
        expect(second).toEqual(first);
      }),
  );

  it(
    'applies the committed migrations as a role that may not create roles, once uw_app exists',
    { timeout },
    async () => {
      let migrator = '';
      try {
        await withEmptyDatabase(server, async (target) => {
          migrator = await asRoleWithoutCreateRole(server, target);
          await applyMigrations(migrator, migrationsFolder);
          expect(await applied(migrator)).toEqual(journalOrder(migrationsFolder));
        });
      } finally {
        if (migrator) await dropRole(server, migrator);
      }
    },
  );

  it('runs a hand-written migration in journal order between generated ones', { timeout }, () =>
    withEmptyDatabase(server, async (target) => {
      const { first, second } = await applyTwice(target, orderedFolder);
      expect(first.applied).toEqual(journalOrder(orderedFolder));
      expect(first.catalog).toEqual([
        'probes.id',
        'probes.note',
        'probes.stage',
        'probes:probes_pkey',
        'probes:probes_stage_known',
      ]);
      expect(second).toEqual(first);
      expect(await insertStage(target, 'merge')).toBe('inserted');
      expect(await insertStage(target, 'checks')).toBe('refused 23514');
    }),
  );
});
