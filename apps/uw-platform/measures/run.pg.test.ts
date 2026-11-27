import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { systemIdentity, type MeasureRunKind } from '@uw/contracts';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { collectionsAt } from '../testing/collections.ts';
import {
  agentOf,
  fakeMeasureSandbox,
  forceActive,
  geoMeasure,
  geoOutput,
  MEASURE_AREA,
  measureWorld,
  PINNED_LOCK,
  newId,
  website,
  type FakeOutput,
  type FakeSandbox,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { sha256Hex } from '../pdf/provenance.ts';
import { activationFor } from './activations.ts';
import { saveMeasure } from './authoring.ts';
import { observationsOfRun } from './observation-records.ts';
import { runMeasure } from './run-measure.ts';
import { insertRun, runById } from './runs.ts';
import { toolHashOf } from './tool.ts';
import { measurePageOf } from './measure-pages.ts';

const at = collectionsAt;

const scored = geoMeasure({
  values: [
    { key: 'score', name: 'Score', type: 'number', path: '/score' },
    { key: 'fixes', name: 'Fixes', type: 'text_list', path: '/recommendations' },
  ],
});

const outputs: ReadonlyMap<string, FakeOutput> = new Map([
  ['a.example.org', geoOutput(81, ['Add an llms.txt'])],
  ['b.example.org', { stdout: 'Score: 64' }],
  ['c.example.org', { stdout: '', exitCode: 2 }],
  ['d.example.org', { stdout: '', exitCode: 1, refusedHosts: ['cdn.example.net'] }],
  ['e.example.org', { stdout: '', exitCode: null, timedOut: true }],
  ['f.example.org', { stdout: '', exitCode: null }],
]);

async function measured(world: MeasureWorld): Promise<string> {
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
    await website(world, `Site ${name}`, `https://${name}.example.org/`);
  }
  const measureId = newId();
  const made = await saveMeasure(
    { db: world.db, actor: agentOf(world.admin), traceId: newId(), at },
    {
      measureId,
      expectedVersion: null,
      jdArea: MEASURE_AREA,
      title: 'GEO score',
      slug: 'geo-score',
      bodyMd: '',
      measure: scored,
    },
  );
  if (!made.ok) throw new Error(made.reason);
  return measureId;
}

async function queued(world: MeasureWorld, measureId: string, kind: MeasureRunKind) {
  const measure = await measurePageOf(world.db, measureId);
  if (measure === null) throw new Error('no measure');
  const runId = newId();
  await insertRun(world.db, {
    id: runId,
    measurePageId: measureId,
    measureVersion: measure.version,
    toolHash: await toolHashOf(measure.measure),
    kind,
    requestedBy: kind === 'trial' ? world.admin.identity : systemIdentity,
    lock: kind === 'trial' ? null : PINNED_LOCK,
    lockSha256: kind === 'trial' ? null : await sha256Hex(PINNED_LOCK),
    area: measure.jdArea,
    createdAt: at,
  });
  return runId;
}

async function run(
  world: MeasureWorld,
  measureId: string,
  kind: MeasureRunKind,
  sandbox: FakeSandbox = fakeMeasureSandbox(outputs),
) {
  const runId = await queued(world, measureId, kind);
  const steps: string[] = [];
  const deps = { db: world.db, files: world.files, sandbox, now: () => at };
  const state = await runMeasure(deps, runId, async (name, work, budget) => {
    steps.push(`${name} ${budget}`);
    return work();
  });
  return { runId, state, sandbox, steps };
}

async function triesTrialMostThree(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  const { runId, state, sandbox } = await run(world, measureId, 'trial');
  expect(state).toBe('partial');
  expect(sandbox.jobs.map((job) => job.address)).toEqual([
    'https://a.example.org/',
    'https://b.example.org/',
    'https://c.example.org/',
  ]);
  expect(sandbox.jobs[0]?.command).toEqual(scored.command);
  expect(sandbox.installs.map((job) => job.lock)).toEqual([null]);
  expect(sandbox.jobs.map((job) => job.lock)).toEqual([PINNED_LOCK, PINNED_LOCK, PINNED_LOCK]);
  expect((await runById(db, runId))?.lockSha256).toMatch(/^[0-9a-f]{64}$/);
}

async function installsInOwnStep(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  await forceActive(world, measureId);
  const { runId, steps, sandbox } = await run(world, measureId, 'scheduled');
  const resources = (await observationsOfRun(db, runId)).map(
    (each) => `resource ${each.resourceId} sandbox`,
  );
  expect(steps.slice(0, 2)).toEqual(['prepare record', 'install sandbox']);
  expect(steps.slice(2, -2).sort()).toEqual(resources.sort());
  expect(steps.slice(-2)).toEqual(['release record', 'finish record']);
  expect(sandbox.installs).toEqual([
    {
      runId,
      runtime: 'uvx',
      packageSpec: 'geo-optimizer-skill==4.19.10',
      lock: PINNED_LOCK,
    },
  ]);
  expect(sandbox.released).toEqual([runId]);
}

async function failsEveryResourceWithInstall(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  const failing = fakeMeasureSandbox(outputs, { stdout: '', exitCode: null, timedOut: true });
  const { runId, state, sandbox } = await run(world, measureId, 'trial', failing);
  expect(state).toBe('failed');
  expect(sandbox.jobs).toEqual([]);
  const observed = await observationsOfRun(db, runId);
  expect(observed.map((each) => each.reason)).toEqual(['timed_out', 'timed_out', 'timed_out']);
  expect(sandbox.released).toEqual([runId]);
}

async function closesRunPastFailedSteps(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  await forceActive(world, measureId);
  const runId = await queued(world, measureId, 'scheduled');
  const sandbox = fakeMeasureSandbox(outputs);
  const full: FakeSandbox = {
    ...sandbox,
    measure: (job) =>
      job.address === 'https://c.example.org/'
        ? Promise.reject(new Error('there is no container instance'))
        : sandbox.measure(job),
  };
  const steps: string[] = [];
  const deps = { db: world.db, files: world.files, sandbox: full, now: () => at };
  const state = await runMeasure(deps, runId, (name, work) => {
    steps.push(name);
    return work();
  });
  expect(state).toBe('partial');
  const observed = await observationsOfRun(db, runId);
  const site = (title: string) => observed.find((each) => each.title === title);
  expect(observed).toHaveLength(6);
  expect(site('Site a')).toMatchObject({ outcome: 'ok' });
  expect(site('Site c')).toMatchObject({ outcome: 'failed', reason: 'tool_failed', values: null });
  expect(site('Site f')).toMatchObject({ outcome: 'failed', reason: 'unreachable' });
  expect(steps.filter((name) => name.startsWith('failed resource'))).toHaveLength(1);
  expect(steps.slice(-2)).toEqual(['release', 'finish']);
  expect(full.released).toEqual([runId]);
}

async function finishesRunWhoseInstallStepFailed(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  await forceActive(world, measureId);
  const runId = await queued(world, measureId, 'scheduled');
  const full: FakeSandbox = {
    ...fakeMeasureSandbox(outputs),
    install: () => Promise.reject(new Error('there is no container instance')),
  };
  const deps = { db: world.db, files: world.files, sandbox: full, now: () => at };
  expect(await runMeasure(deps, runId, (_name, work) => work())).toBe('failed');
  expect(await runById(db, runId)).toMatchObject({ state: 'failed', finishedAt: at });
  expect(full.released).toEqual([runId]);
}

async function recordsFailureReasonValue(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  await forceActive(world, measureId);
  const { runId, state } = await run(world, measureId, 'scheduled');
  expect(state).toBe('partial');
  const observed = await observationsOfRun(db, runId);
  expect(observed.map((each) => [each.title, each.outcome, each.reason])).toEqual([
    ['Site a', 'ok', null],
    ['Site b', 'failed', 'output_not_json'],
    ['Site c', 'failed', 'tool_failed'],
    ['Site d', 'failed', 'host_refused'],
    ['Site e', 'failed', 'timed_out'],
    ['Site f', 'failed', 'unreachable'],
  ]);
  expect(observed[0]?.values).toEqual({ score: 81, fixes: ['Add an llms.txt'] });
  expect(observed.slice(1).every((each) => each.values === null)).toBe(true);
  const raw = await world.files.get(observed[0]?.rawKey ?? '');
  expect(new TextDecoder().decode(raw?.bytes)).toBe(outputs.get('a.example.org')?.stdout);
  expect((await runById(db, runId))?.refusedHosts).toEqual(['cdn.example.net']);
  expect(await sha256Hex(raw?.bytes ?? new Uint8Array())).toMatch(/^[0-9a-f]{64}$/);
}

async function pausesScheduledRunWhose(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  await forceActive(world, measureId);
  const grant = world.admin.grants.find((each) => each.role === 'admin');
  await revokeSeededGrant(db, grant?.grantId ?? '', new Date(at.getTime() - 1000));
  const { runId, state, sandbox } = await run(world, measureId, 'scheduled');
  expect(state).toBe('failed');
  expect(sandbox.jobs).toEqual([]);
  expect(await observationsOfRun(db, runId)).toEqual([]);
  expect((await activationFor(db, measureId))?.pausedReason).toBe('activator_lost_access');
}

describe.skipIf(!testServer)('a measure run observes each resource in its own step', () => {
  it('tries a trial on at most three resources of the view', () =>
    withAppDatabase(triesTrialMostThree));

  it('records every failure with its reason and no value, and keeps the raw output', () =>
    withAppDatabase(recordsFailureReasonValue));

  it('pauses a scheduled run whose activator lost admin and observes nothing', () =>
    withAppDatabase(pausesScheduledRunWhose));

  it('installs the package in its own sandbox step, then lets the container go', () =>
    withAppDatabase(installsInOwnStep));

  it('records every resource with the reason the install failed, and measures none', () =>
    withAppDatabase(failsEveryResourceWithInstall));

  it('records a resource whose step ran out of retries as failed and measures the rest', () =>
    withAppDatabase(closesRunPastFailedSteps));

  it('still closes the run from what it observed when its install step ran out of retries', () =>
    withAppDatabase(finishesRunWhoseInstallStepFailed));
});
