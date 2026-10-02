import { and, eq, inArray, sql } from 'drizzle-orm';
import { pgSchema, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const harnessId = '00000000-0000-4000-8000-0000000000a1';
const at = new Date('2026-10-01T09:00:00.000Z');
const constraintName = 'harness_stages_effect_needs_human_gate';

const columns = pgSchema('information_schema').table('columns', {
  tableName: text('table_name'),
  columnName: text('column_name'),
  isNullable: text('is_nullable'),
  columnDefault: text('column_default'),
});

const constraints = pgSchema('pg_catalog').table('pg_constraint', {
  conname: text('conname'),
  oid: text('oid'),
});

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function stageId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function insertStage(
  db: OpenedDatabase['db'],
  n: number,
  connector: string,
  exitGate: string | null,
) {
  return db.execute(sql`INSERT INTO harness_stages
    (id, harness_id, key, title, position, bracket, agent_pickup, exit_gate, connector)
    VALUES (${stageId(n)}, ${harnessId}, ${`s${n}`}, 'Stage', ${n},
      'deploy_package', 'none', ${exitGate}, ${connector})`);
}

function columnFacts(db: OpenedDatabase['db']) {
  return db
    .select({
      name: columns.columnName,
      nullable: columns.isNullable,
      fallback: columns.columnDefault,
    })
    .from(columns)
    .where(
      and(
        eq(columns.tableName, 'harness_stages'),
        inArray(columns.columnName, ['connector', 'exit_gate']),
      ),
    )
    .orderBy(columns.columnName);
}

function constraintDefinition(db: OpenedDatabase['db']) {
  return db
    .select({ definition: sql<string>`pg_get_constraintdef(${constraints.oid}::oid)` })
    .from(constraints)
    .where(eq(constraints.conname, constraintName));
}

function describeTarget(target: DatabaseTarget): void {
  let opened: OpenedDatabase | undefined;
  const db = () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
  beforeAll(async () => {
    opened = await target.open();
    await db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (${harnessId}, 'software', 'software', '80-89', ${at.toISOString()}::timestamptz)`);
  }, 60_000);
  afterAll(() => opened?.close());

  it('declares connector and exit_gate NOT NULL, connector defaulting to none', async () => {
    const rows = await columnFacts(db());
    expect(rows.map((row) => [row.name, row.nullable])).toEqual([
      ['connector', 'NO'],
      ['exit_gate', 'NO'],
    ]);
    expect(rows[0]?.fallback).toMatch(/^'none'/);
  });

  it('holds the constraint connector = none OR exit_gate = human_approval', async () => {
    const rows = await constraintDefinition(db());
    expect(rows[0]?.definition).toMatch(/connector.*'none'.*OR.*exit_gate.*'human_approval'/);
  });

  it('refuses an insert of (merge, checks) and of (merge, NULL)', async () => {
    expect(await refusal(insertStage(db(), 0x10, 'merge', 'checks'))).toEqual({
      code: '23514',
      constraint: constraintName,
    });
    expect((await refusal(insertStage(db(), 0x11, 'merge', null))).code).toBe('23502');
  });

  it('refuses an update to (merge, checks) and accepts (merge, human_approval)', async () => {
    await insertStage(db(), 0x20, 'merge', 'human_approval');
    const lowered = db().execute(
      sql`UPDATE harness_stages SET exit_gate = 'checks' WHERE id = ${stageId(0x20)}`,
    );
    expect(await refusal(lowered)).toEqual({ code: '23514', constraint: constraintName });
  });
}

describe('KN-2 DX-6 the Ship invariant holds in Postgres', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
