import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { seedPage, seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const person = '00000000-0000-4000-8000-0000003400a1';
const measure = '00000000-0000-4000-8000-0000003400b1';
const site = '00000000-0000-4000-8000-0000003400c1';
const run = '00000000-0000-4000-8000-0000003400d1';
const at = '2026-11-25T09:00:00.000Z';
const hash = 'a'.repeat(64);

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type Row = Readonly<Record<string, string | number | null>>;

function addRun(db: AnyDatabase, id: string, row: Row = {}) {
  const value = (key: string, fallback: string | number | null) =>
    key in row ? (row[key] ?? null) : fallback;
  return db.execute(sql`INSERT INTO measure_runs
      (id, measure_page_id, measure_version, tool_hash, kind, requested_by, state, lock,
       lock_sha256, refused_hosts, area, created_at, started_at, finished_at)
    VALUES (${id}, ${measure}, ${value('version', 1)}, ${value('toolHash', hash)},
      ${value('kind', 'trial')}, ${value('requestedBy', `human:${person}`)},
      ${value('state', 'queued')}, ${value('lock', null)}, ${value('lockSha256', null)},
      ${value('refusedHosts', '[]')}::jsonb, ${value('area', '30-39')}, ${at}::timestamptz,
      ${value('startedAt', null)}::timestamptz, ${value('finishedAt', null)}::timestamptz)`);
}

function addObservation(db: AnyDatabase, id: string, row: Row = {}) {
  const value = (key: string, fallback: string | number | null) =>
    key in row ? (row[key] ?? null) : fallback;
  return db.execute(sql`INSERT INTO observations
      (id, run_id, measure_page_id, measure_version, resource_page_id, observed_at, tool_version,
       values, outcome, reason, raw_key, raw_sha256, raw_length, area)
    VALUES (${id}, ${run}, ${measure}, 1, ${value('resource', site)}, ${at}::timestamptz,
      '4.19.10', ${value('values', '{"score": 84}')}::jsonb, ${value('outcome', 'ok')},
      ${value('reason', null)}, ${value('rawKey', `measures/raw/${run}/${site}.json`)},
      ${value('rawSha256', hash)}, ${value('rawLength', 120)}, ${value('area', '30-39')})`);
}

function addActivation(db: AnyDatabase, row: Row = {}) {
  const value = (key: string, fallback: string | number | null) =>
    key in row ? (row[key] ?? null) : fallback;
  return db.execute(sql`INSERT INTO measure_activations
      (measure_page_id, version, tool_hash, lock, lock_sha256, activator_person_id, area,
       activated_at, next_run_at, paused_reason)
    VALUES (${measure}, ${value('version', 2)}, ${hash}, 'geo-optimizer-skill==4.19.10',
      ${value('lockSha256', hash)}, ${person}, ${value('area', '30-39')}, ${at}::timestamptz,
      ${at}::timestamptz, ${value('pausedReason', null)})`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: person, email: 'measure-admin@example.org' });
    const page = { status: 'suggested' as const, jdArea: '30-39', bodyMd: '', frontmatter: {} };
    await seedPage(opened.db, { ...page, id: measure, type: 'measure', slug: 'geo', title: 'GEO' });
    await seedPage(opened.db, { ...page, id: site, type: 'resource', slug: 'uw', title: 'uW' });
    await addRun(opened.db, run);
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

const runRefusals: readonly (readonly [string, Row, string])[] = [
  ['an unknown kind', { kind: 'manual' }, 'measure_runs_kind_known'],
  ['an unknown state', { state: 'done' }, 'measure_runs_state_known'],
  [
    'a requester that is not an identity',
    { requestedBy: 'cron' },
    'measure_runs_requested_by_identity',
  ],
  ['a tool hash that is not hex', { toolHash: 'geo' }, 'measure_runs_tool_hash_form'],
  ['a lock without its hash', { lock: 'geo==1' }, 'measure_runs_lock_hashed'],
  ['refused hosts that are not a list', { refusedHosts: '{}' }, 'measure_runs_refused_hosts_list'],
  ['an area that is not a JD area', { area: '30-49' }, 'measure_runs_area_form'],
  ['a finished run with no finish time', { state: 'ok' }, 'measure_runs_finished_has_time'],
];

const observationRefusals: readonly (readonly [string, Row, string])[] = [
  ['an unknown outcome', { outcome: 'zero' }, 'observations_outcome_known'],
  [
    'an unknown reason',
    { outcome: 'failed', reason: 'oops', values: null },
    'observations_reason_known',
  ],
  [
    'a failure with no reason',
    { outcome: 'failed', values: null },
    'observations_failed_has_reason',
  ],
  [
    'a failure counted as zero',
    { outcome: 'failed', reason: 'timed_out' },
    'observations_failed_has_reason',
  ],
  ['a success with no values', { values: null }, 'observations_ok_has_values'],
  ['values that are not an object', { values: '[84]' }, 'observations_values_object'],
  ['raw output without its hash', { rawSha256: null }, 'observations_raw_hashed'],
  ['a raw hash that is not hex', { rawSha256: 'abc' }, 'observations_raw_sha256_form'],
  ['raw output without its length', { rawLength: null }, 'observations_raw_measured'],
  ['a length without raw output', { rawKey: null, rawSha256: null }, 'observations_raw_measured'],
  ['a negative raw length', { rawLength: -1 }, 'observations_raw_length_counted'],
];

const activationRefusals: readonly (readonly [string, Row, string])[] = [
  ['an unknown pause', { pausedReason: 'tired' }, 'measure_activations_paused_reason_known'],
  ['a lock hash that is not hex', { lockSha256: 'abc' }, 'measure_activations_lock_sha256_form'],
  ['a version below one', { version: 0 }, 'measure_activations_version_counted'],
];

function rowRules(db: () => AnyDatabase): void {
  it('ADR 0036 records a trial, an ok and a failed observation, and an activation', async () => {
    await addObservation(db(), '00000000-0000-4000-8000-0000003400e1');
    await addObservation(db(), '00000000-0000-4000-8000-0000003400e2', {
      resource: measure,
      outcome: 'failed',
      reason: 'timed_out',
      values: null,
      rawKey: null,
      rawSha256: null,
      rawLength: null,
    });
    await addActivation(db());
  });

  it('ADR 0036 keeps one observation per resource per run', async () => {
    const again = addObservation(db(), '00000000-0000-4000-8000-0000003400e9');
    expect(await refusal(again)).toEqual({ code: '23505', constraint: 'observations_one_per_run' });
  });

  it.each(runRefusals)('ADR 0036 refuses a run with %s', async (_name, change, constraint) => {
    const id = '00000000-0000-4000-8000-0000003400d9';
    expect(await refusal(addRun(db(), id, change))).toEqual({ code: '23514', constraint });
  });

  it.each(observationRefusals)('ADR 0036 refuses %s', async (_name, change, constraint) => {
    const row = { resource: measure, ...change };
    const id = '00000000-0000-4000-8000-0000003400e8';
    expect(await refusal(addObservation(db(), id, row))).toEqual({ code: '23514', constraint });
  });

  it.each(activationRefusals)('ADR 0036 refuses %s', async (_name, change, constraint) => {
    await db().execute(sql`DELETE FROM measure_activations`);
    expect(await refusal(addActivation(db(), change))).toEqual({ code: '23514', constraint });
  });
}

describe('ADR 0036 the measures tables', () => {
  it('declares the activations, runs and observations internal and never offline', () => {
    const declared = [schema.measureActivations, schema.measureRuns, schema.observationRecords];
    expect(declared.map(declarationOf)).toEqual(
      declared.map(() => ({ classification: 'internal', offlineEligibility: 'never' })),
    );
  });

  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => rowRules(openDatabase(target)),
  );
});
