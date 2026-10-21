import { eq, inArray, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { harnesses } from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const pgConstraints = pgSchema('pg_catalog').table('pg_constraint', { name: text('conname') });

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function fixClaimColumns(db: () => Db): void {
  it('FL-1 a harness starts with the fix claim off', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'fix-claim-default', 'software', '80-89', now())`);
    const rows = await db()
      .select({ fixClaim: harnesses.fixClaim })
      .from(harnesses)
      .where(eq(harnesses.key, 'fix-claim-default'));
    expect(rows[0]).toEqual({ fixClaim: false });
  });

  it('FL-1 FL-2 FL-4 admits the new event, command and run-failure names', async () => {
    const checks = await db()
      .select({ name: pgConstraints.name, definition: sql<string>`pg_get_constraintdef(oid)` })
      .from(pgConstraints)
      .where(
        inArray(pgConstraints.name, [
          'harness_events_name_known',
          'command_requests_command_known',
          'harness_runs_failure_known',
        ]),
      );
    const definitions = checks.map((row) => row.definition).join(' ');
    for (const name of [
      'fix_claimed',
      'fix_claim_set',
      'set_fix_claim',
      'checks_not_run_locally',
    ]) {
      expect(definitions).toContain(`'${name}'`);
    }
  });
}

describe('the fix claim column', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => fixClaimColumns(openDatabase(target)),
  );
});
