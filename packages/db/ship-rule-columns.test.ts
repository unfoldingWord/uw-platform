import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultCiChecks, requiredChecksSchema } from '@uw/contracts';
import { eq, inArray, sql } from 'drizzle-orm';
import { harnesses } from './schema.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

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

async function definitions(db: Db, names: readonly string[]): Promise<string[]> {
  const rows = await db
    .select({ definition: sql<string>`pg_get_constraintdef(oid)` })
    .from(sql`pg_constraint`)
    .where(inArray(sql`conname`, [...names]));
  return rows.map((row) => row.definition);
}

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function shipRuleColumns(db: () => Db): void {
  it('GD-2 SR-1 a harness starts unfrozen with no allow list and no required checks', async () => {
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (gen_random_uuid(), 'ship-defaults', 'software', '80-89', now())`);
    const rows = await db()
      .select({
        frozen: harnesses.frozen,
        allow: harnesses.freezeAllow,
        checks: harnesses.requiredChecks,
      })
      .from(harnesses)
      .where(eq(harnesses.key, 'ship-defaults'));
    expect(rows[0]).toEqual({ frozen: false, allow: [], checks: [] });
  });

  it('SR-1 refuses required checks that are not an array by harnesses_required_checks_array', async () => {
    const insert = db()
      .execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at, required_checks)
      VALUES (gen_random_uuid(), 'ship-object', 'software', '80-89', now(), '{}'::jsonb)`);
    expect(await refusal(insert)).toEqual({
      code: '23514',
      constraint: 'harnesses_required_checks_array',
    });
  });

  it('SR-1 refuses a negative distance behind the base by gh_prs_behind_by_counted', async () => {
    const found = await definitions(db(), ['gh_prs_behind_by_counted']);
    expect(found.join(' ')).toContain('behind_by >= 0');
  });

  it('GD-2 RV-2 admits the new event, command and run-failure names', async () => {
    const found = await definitions(db(), [
      'harness_events_name_known',
      'command_requests_command_known',
      'harness_runs_failure_known',
    ]);
    const text = found.join(' ');
    for (const name of [
      'freeze_changed',
      'finding_refuted',
      'set_freeze',
      'decide_gates',
      'refute_finding',
      'engine_refused',
      'finding_weight_missing',
    ]) {
      expect(text).toContain(`'${name}'`);
    }
  });
}

describe('the ship rule and gate columns', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => shipRuleColumns(openDatabase(target)),
  );
});

describe('SR-1 the S15-R1 backfill names the six CI jobs', () => {
  it('SR-1 writes defaultCiChecks on the uw-platform harness', () => {
    const migration = join(import.meta.dirname, 'migrations', '0032_ship_rule_and_gates.sql');
    const text = readFileSync(migration, 'utf8');
    const literal = /SET "required_checks" = '([^']*)'::jsonb/u.exec(text)?.[1] ?? null;
    expect(literal).not.toBeNull();
    const parsed = requiredChecksSchema.parse(JSON.parse(literal ?? 'null'));
    expect(parsed).toEqual(defaultCiChecks);
  });
});
