import { asc, eq, sql } from 'drizzle-orm';
import { pgSchema, integer, text } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

type Db = OpenedDatabase['db'];

const at = new Date('2026-10-01T09:00:00.000Z');
const atText = at.toISOString();
const harnessA = '00000000-0000-4000-8000-0000000000b1';
const harnessB = '00000000-0000-4000-8000-0000000000b2';
const stageA = '00000000-0000-4000-8000-0000000000c1';
const stageB = '00000000-0000-4000-8000-0000000000c2';
const itemA = '00000000-0000-4000-8000-0000000000d1';
const trace = '00000000-0000-4000-8000-0000000000e1';

const informationColumns = pgSchema('information_schema').table('columns', {
  tableName: text('table_name'),
  columnName: text('column_name'),
  ordinalPosition: integer('ordinal_position'),
});

const expectedDeclarations = [
  [schema.harnesses, 'internal', 'sync'],
  [schema.harnessStages, 'internal', 'sync'],
  [schema.harnessItems, 'internal', 'sync'],
  [schema.harnessRuns, 'internal', 'never'],
  [schema.gateDecisions, 'restricted', 'never'],
  [schema.delegations, 'restricted', 'never'],
  [schema.measurements, 'internal', 'cache_readonly'],
  [schema.personas, 'internal', 'sync'],
] as const;

const expectedColumns: Record<string, string[]> = {
  harnesses: [
    'id',
    'key',
    'template',
    'jd_area',
    'hosted_builder_enabled',
    'paused',
    'created_at',
    'repository',
    'shadow',
    'external_reviewer_identities',
    'frozen',
    'freeze_allow',
    'required_checks',
    'protected_paths',
  ],
  harness_stages: [
    'id',
    'harness_id',
    'key',
    'title',
    'position',
    'bracket',
    'agent_pickup',
    'exit_gate',
    'connector',
    'wip_limit',
    'instructions_page_id',
    'validators',
    'feeds',
    'paused',
  ],
  harness_items: [
    'id',
    'harness_id',
    'stage_id',
    'title',
    'page_id',
    'priority',
    'due',
    'claimed_by',
    'claimant_kind',
    'delegation_id',
    'lease_expires',
    'gate_status',
    'gate_target',
    'risk_tier',
    'risk_domains',
    'expected_head',
    'branch_state',
    'pr_repo',
    'pr_number',
    'zulip_topic',
    'created_at',
    'issue_repo',
    'issue_number',
    'issue_github_id',
  ],
  harness_runs: [
    'id',
    'harness_id',
    'item_id',
    'persona',
    'run_shape',
    'engine',
    'model',
    'resolved_provider',
    'steps',
    'cost_minor',
    'cost_basis',
    'trace_id',
    'outcome',
    'started_at',
    'ended_at',
    'persona_page_id',
    'delegation_id',
    'pinned_provider',
    'compute_minor',
    'hibernated_for',
    'failure',
    'gates',
    'prompts',
  ],
  gate_decisions: [
    'id',
    'harness_id',
    'item_id',
    'stage_id',
    'actor',
    'decision',
    'reason',
    'evidence',
    'trace_id',
    'decided_at',
    'agent_actor',
    'delegation_id',
  ],
  delegations: [
    'id',
    'person_id',
    'persona',
    'harness_id',
    'capability',
    'granted_at',
    'expires_at',
    'revoked_at',
    'lapsed_at',
    'supersedes',
    'trace_id',
    'max_tier',
  ],
  measurements: ['id', 'harness_id', 'item_id', 'source', 'name', 'value', 'as_of', 'recorded_at'],
  personas: ['identity', 'harness_id', 'page_id'],
};

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

function messageChain(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return `${error.message} ${error.cause === undefined ? '' : messageChain(error.cause)}`;
}

async function refusalMessage(work: PromiseLike<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return messageChain(error);
  }
  throw new Error('expected the database to refuse');
}

async function columnsOf(db: Db, table: string): Promise<string[]> {
  const rows = await db
    .select({ name: informationColumns.columnName })
    .from(informationColumns)
    .where(eq(informationColumns.tableName, table))
    .orderBy(asc(informationColumns.ordinalPosition));
  return rows.map((row) => row.name ?? '');
}

function insertHarness(db: Db, id: string, key: string, area: string) {
  return db.execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
    VALUES (${id}, ${key}, 'software', ${area}, ${atText}::timestamptz)`);
}

function insertStage(db: Db, id: string, harness: string, key: string, position: number) {
  return db.execute(sql`INSERT INTO harness_stages
    (id, harness_id, key, title, position, bracket, agent_pickup, exit_gate, connector)
    VALUES (${id}, ${harness}, ${key}, 'Stage', ${position}, 'deploy_package', 'none',
      'human_approval', 'none')`);
}

function insertItem(
  db: Db,
  id: string,
  stage: string,
  extra: { claimedBy?: string; kind?: string; lease?: Date; domains?: string } = {},
) {
  return db.execute(sql`INSERT INTO harness_items
    (id, harness_id, stage_id, title, claimed_by, claimant_kind, lease_expires, risk_domains,
     created_at)
    VALUES (${id}, ${harnessA}, ${stage}, 'Item', ${extra.claimedBy ?? null},
      ${extra.kind ?? null}, ${extra.lease?.toISOString() ?? null}::timestamptz,
      ${sql.raw(`'${extra.domains ?? '{}'}'::text[]`)}, ${atText}::timestamptz)`);
}

function insertDecision(
  db: Db,
  id: string,
  actor: string,
  decision: string,
  reason: string | null,
) {
  return db.execute(sql`INSERT INTO gate_decisions
    (id, harness_id, item_id, stage_id, actor, decision, reason, evidence, trace_id, decided_at)
    VALUES (${id}, ${harnessA}, ${itemA}, ${stageA}, ${actor}, ${decision}, ${reason},
      '{}'::jsonb, ${trace}, ${atText}::timestamptz)`);
}

function idOf(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function openDatabase(target: DatabaseTarget): () => Db {
  let opened: OpenedDatabase | undefined;
  const db = () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
  beforeAll(async () => {
    opened = await target.open();
    await insertHarness(db(), harnessA, 'software', '80-89');
    await insertHarness(db(), harnessB, 'bml', '10-19');
    await insertStage(db(), stageA, harnessA, 'ship', 1);
    await insertStage(db(), stageB, harnessB, 'ship', 1);
    await insertItem(db(), itemA, stageA);
  }, 60_000);
  afterAll(() => opened?.close());
  return db;
}

function tableShape(db: () => Db): void {
  it('KN-1 declares classification and offline eligibility on every harness table', () => {
    for (const [table, classification, offlineEligibility] of expectedDeclarations) {
      expect(declarationOf(table)).toEqual({ classification, offlineEligibility });
    }
  });

  it.each(Object.entries(expectedColumns))(
    'KN-1 creates %s with the PRD 8.1 columns',
    async (table, list) => {
      expect(await columnsOf(db(), table)).toEqual(list);
    },
  );

  it('KN-1 declares harnesses.jd_area NOT NULL', async () => {
    const missing = db().execute(sql`INSERT INTO harnesses (id, key, template, jd_area, created_at)
      VALUES (${idOf(0xb4)}, 'unscoped', 'software', NULL, ${atText}::timestamptz)`);
    expect((await refusal(missing)).code).toBe('23502');
  });

  it('KN-1 refuses a jd_area that is a range of areas', async () => {
    expect(await refusal(insertHarness(db(), idOf(0xb3), 'wide', '80-99'))).toEqual({
      code: '23514',
      constraint: 'harnesses_area_form',
    });
  });
}

function gateDecisionRules(db: () => Db): void {
  it('refuses an agent actor', async () => {
    expect(
      await refusal(insertDecision(db(), idOf(0xf1), 'agent:builder', 'approve', null)),
    ).toEqual({
      code: '23514',
      constraint: 'gate_decisions_actor_is_human',
    });
  });

  it('refuses an override with a blank reason', async () => {
    expect(await refusal(insertDecision(db(), idOf(0xf2), 'human:ian', 'override', '  '))).toEqual({
      code: '23514',
      constraint: 'gate_decisions_override_has_reason',
    });
  });

  it('refuses an update, a delete and a truncate with the trigger message', async () => {
    await insertDecision(db(), idOf(0xf3), 'human:ian', 'approve', null);
    const changed = db().execute(
      sql`UPDATE gate_decisions SET reason = 'x' WHERE id = ${idOf(0xf3)}`,
    );
    const removed = db().execute(sql`DELETE FROM gate_decisions WHERE id = ${idOf(0xf3)}`);
    const emptied = db().execute(sql`TRUNCATE gate_decisions`);
    expect((await refusal(changed)).code).toBe('P0001');
    expect(await refusalMessage(changed)).toContain('gate_decisions is append-only');
    expect(await refusalMessage(removed)).toContain('gate_decisions is append-only');
    expect(await refusalMessage(emptied)).toContain('gate_decisions is append-only');
  });
}

function itemRules(db: () => Db): void {
  it('refuses a person claim with a lease', async () => {
    const leased = insertItem(db(), idOf(0xa1), stageA, {
      claimedBy: 'human:ian',
      kind: 'person',
      lease: at,
    });
    expect(await refusal(leased)).toEqual({
      code: '23514',
      constraint: 'harness_items_person_has_no_lease',
    });
  });

  it('refuses a risk domain outside the closed set', async () => {
    expect(await refusal(insertItem(db(), idOf(0xa2), stageA, { domains: '{ui}' }))).toEqual({
      code: '23514',
      constraint: 'harness_items_risk_domains_known',
    });
  });

  it('refuses a stage of another harness', async () => {
    expect(await refusal(insertItem(db(), idOf(0xa3), stageB))).toEqual({
      code: '23503',
      constraint: 'harness_items_stage_fk',
    });
  });
}

function insertDelegation(db: Db, id: string, supersedes: string | null) {
  return db.execute(sql`INSERT INTO delegations
      (id, person_id, persona, harness_id, capability, granted_at, expires_at, supersedes, trace_id)
    VALUES (${id}, '00000000-0000-4000-8000-000000000001', 'agent:builder', ${harnessA}, 'build',
      ${atText}::timestamptz, ${atText}::timestamptz + interval '1 day', ${supersedes},
      ${idOf(0xe9)})`);
}

function delegationRules(db: () => Db): void {
  it('lets one delegation, and only one, supersede another', async () => {
    await insertDelegation(db(), idOf(0xd1), null);
    await insertDelegation(db(), idOf(0xd2), null);
    await insertDelegation(db(), idOf(0xd3), idOf(0xd1));
    expect(await refusal(insertDelegation(db(), idOf(0xd4), idOf(0xd1)))).toEqual({
      code: '23505',
      constraint: 'delegations_supersedes_once',
    });
  });
}

type RunColumns = {
  shape?: string;
  engine?: string;
  outcome?: string;
  hibernatedFor?: string;
  failure?: string;
  steps?: string;
  prompts?: string;
};

function insertRun(db: Db, id: string, columns: RunColumns = {}) {
  return db.execute(sql`INSERT INTO harness_runs
    (id, harness_id, item_id, persona, run_shape, engine, model, cost_basis, trace_id, outcome,
     hibernated_for, failure, steps, prompts, started_at)
    VALUES (${id}, ${harnessA}, ${itemA}, 'agent:builder', ${columns.shape ?? 'workflow-run'},
      ${columns.engine ?? 'claude-messages'}, 'm', 'metered', ${trace},
      ${columns.outcome ?? 'stopped'}, ${columns.hibernatedFor ?? null}, ${columns.failure ?? null},
      ${columns.steps ?? '[]'}::jsonb, ${columns.prompts ?? '[]'}::jsonb, ${atText}::timestamptz)`);
}

function jsonArrayOf(length: number): string {
  return JSON.stringify(Array.from({ length }, () => 'x'));
}

const runRefusals: readonly (readonly [string, RunColumns, string])[] = [
  [
    'a hibernation reason outside the closed set',
    { outcome: 'hibernated', hibernatedFor: 'nap' },
    'harness_runs_hibernated_for_known',
  ],
  [
    'a reason on a run that is not hibernated',
    { hibernatedFor: 'gate' },
    'harness_runs_hibernated_has_why',
  ],
  ['a failure outside the closed set', { failure: 'lease_lost' }, 'harness_runs_failure_known'],
  [
    'an external run on a hosted engine',
    { shape: 'external-run' },
    'harness_runs_shape_matches_engine',
  ],
  [
    'a hosted run on the external engine',
    { engine: 'external' },
    'harness_runs_shape_matches_engine',
  ],
  ['more than 200 steps', { steps: jsonArrayOf(201) }, 'harness_runs_steps_bounded'],
  ['steps that are not an array', { steps: '{}' }, 'harness_runs_steps_bounded'],
  ['more than 20 prompts', { prompts: jsonArrayOf(21) }, 'harness_runs_prompts_bounded'],
];

function runRules(db: () => Db): void {
  it.each(runRefusals)('refuses %s', async (_title, columns, constraint) => {
    expect(await refusal(insertRun(db(), idOf(0x7f), columns))).toEqual({
      code: '23514',
      constraint,
    });
  });

  it('takes 200 steps, 20 prompts and empty gates by default', async () => {
    await insertRun(db(), idOf(0x71), { steps: jsonArrayOf(200), prompts: jsonArrayOf(20) });
    const rows = await db()
      .select({ gates: schema.harnessRuns.gates })
      .from(schema.harnessRuns)
      .where(eq(schema.harnessRuns.id, idOf(0x71)));
    expect(rows).toEqual([{ gates: [] }]);
  });
}

function describeTarget(target: DatabaseTarget): void {
  const db = openDatabase(target);
  tableShape(db);
  describe('KN-1 gate_decisions takes only a human actor and is append-only', () =>
    gateDecisionRules(db));
  describe('harness_items refuses a contradictory row', () => itemRules(db));
  describe('KN-16 delegations are renewed at most once each', () => delegationRules(db));
  describe('harness_runs refuses a contradictory run', () => runRules(db));
}

describe('KN-1 the harness tables', () => {
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
