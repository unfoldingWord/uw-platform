import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import type { MeasureFrontmatter, Principal } from '@uw/contracts';
import { collectionsAt } from '../testing/collections.ts';
import {
  agentOf,
  fakeMeasureSandbox,
  geoMeasure,
  geoOutput,
  heldRuns,
  inlineMeasureRuns,
  MEASURE_AREA,
  measureWorld,
  newId,
  website,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { activateDashboard, activateMeasure } from './activation.ts';
import { activationFor } from './activations.ts';
import { saveDashboard, saveMeasure } from './authoring.ts';
import { measurePageOf } from './measure-pages.ts';
import type { MeasureRunBinding } from './sandbox.ts';
import { requestRun } from './run-now.ts';
import { latestRunOf } from './runs.ts';
import { startTrial } from './trial.ts';

const at = collectionsAt;
const LATER = new Date(at.getTime() + 2 * 3_600_000);

const scored = geoMeasure({
  values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
  metrics: [{ key: 'average_score', name: 'Average score', value: 'score', rule: 'average' }],
});

type Scene = MeasureWorld & { readonly measureId: string };

async function scene(db: MeasureWorld['db'], measure: MeasureFrontmatter = scored) {
  const world = await measureWorld(db);
  await website(world, 'unfoldingWord', 'https://www.unfoldingword.org/');
  await website(world, 'Door43', 'https://door43.org/');
  const measureId = newId();
  const made = await saveMeasure(
    { db, actor: agentOf(world.admin), traceId: newId(), at },
    {
      measureId,
      expectedVersion: null,
      jdArea: MEASURE_AREA,
      title: 'GEO score',
      slug: `geo-${measureId.slice(0, 8)}`,
      bodyMd: 'GEO score of our websites.',
      measure,
    },
  );
  if (!made.ok) throw new Error(made.reason);
  return { ...world, measureId };
}

function runs(world: Scene, outputs = new Map([['www.unfoldingword.org', geoOutput(81)]])) {
  const sandbox = fakeMeasureSandbox(
    new Map([['door43.org', geoOutput(64)], ...outputs.entries()]),
  );
  return inlineMeasureRuns({ db: world.db, files: world.files, sandbox, now: () => at });
}

function trial(
  world: Scene,
  actor: Principal,
  binding: MeasureRunBinding | null = runs(world),
  version = 1,
) {
  const command = {
    command: 'run_measure_trial' as const,
    requestId: newId(),
    measureId: world.measureId,
    expectedVersion: version,
  };
  return startTrial(world.db, actor, command, { binding, traceId: newId() }, at);
}

function activate(world: Scene, actor: Principal, version = 1, dashboards: string[] = []) {
  const command = {
    command: 'activate_measure' as const,
    requestId: newId(),
    measureId: world.measureId,
    expectedVersion: version,
    dashboards,
  };
  return activateMeasure(world.db, actor, command, {
    files: world.files,
    traceId: newId(),
    at,
  });
}

async function runsResourcesViewKeeps(db: Database): Promise<void> {
  const world = await scene(db);
  const trialed = await trial(world, world.admin);
  expect(trialed).toMatchObject({ ok: true, state: 'ok' });
  const run = await latestRunOf(db, world.measureId);
  expect(run).toMatchObject({ kind: 'trial', state: 'ok', requestedBy: world.admin.identity });
  expect(run?.lock).toContain('geo-optimizer-skill==4.19.10');
}

async function refusesAgentEditorStale(db: Database): Promise<void> {
  const world = await scene(db);
  expect(await trial(world, agentOf(world.admin))).toEqual({
    ok: false,
    reason: 'not_permitted',
  });
  expect(await trial(world, world.editor)).toEqual({ ok: false, reason: 'not_permitted' });
  expect(await trial(world, world.admin, runs(world), 2)).toEqual({
    ok: false,
    reason: 'stale_version',
  });
  expect(await trial(world, world.admin, null)).toEqual({ ok: false, reason: 'not_wired' });
  expect(await latestRunOf(db, world.measureId)).toBeNull();
}

async function refusesActivationBeforeTrial(db: Database): Promise<void> {
  const world = await scene(db);
  expect(await activate(world, world.admin)).toEqual({ ok: false, reason: 'trial_required' });
}

function resave(world: Scene, expectedVersion: number, measure: MeasureFrontmatter) {
  return saveMeasure(
    { db: world.db, actor: agentOf(world.admin), traceId: newId(), at },
    {
      measureId: world.measureId,
      expectedVersion,
      jdArea: MEASURE_AREA,
      title: 'GEO score',
      slug: `geo-${world.measureId.slice(0, 8)}`,
      bodyMd: 'GEO score of our websites.',
      measure,
    },
  );
}

async function refusesTrialWhoseOutput(db: Database): Promise<void> {
  const world = await scene(db);
  await trial(world, world.admin);
  const renamed = geoMeasure({
    values: [{ key: 'score', name: 'Score', type: 'number', path: '/result/score' }],
  });
  await resave(world, 1, renamed);
  expect(await activate(world, world.admin, 2)).toEqual({
    ok: false,
    reason: 'trial_unreadable',
  });
}

async function refusesTrialAlreadyInFlight(db: Database): Promise<void> {
  const world = await scene(db);
  expect(await trial(world, world.admin, heldRuns())).toMatchObject({ ok: true, state: 'queued' });
  expect(await trial(world, world.admin, heldRuns())).toEqual({
    ok: false,
    reason: 'request_in_flight',
  });
}

async function rollsBackWhenDashboardRefused(db: Database): Promise<void> {
  const world = await scene(db);
  await trial(world, world.admin);
  expect(await activate(world, world.admin, 1, [newId()])).toEqual({
    ok: false,
    reason: 'page_not_found',
  });
  expect((await measurePageOf(db, world.measureId))?.status).toBe('suggested');
  expect(await activationFor(db, world.measureId)).toBeNull();
}

const targeted = geoMeasure({
  values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
  metrics: [
    { key: 'average_score', name: 'Average score', value: 'score', rule: 'average', target: 90 },
  ],
});

async function reactivatesOnlyWhenToolKept(db: Database): Promise<void> {
  const world = await scene(db);
  await trial(world, world.admin);
  await activate(world, world.admin);
  const kept = await resave(world, 2, targeted);
  expect(kept).toMatchObject({ ok: true, value: { status: 'suggested', awaiting: 'activation' } });
  const starter = { binding: heldRuns(), traceId: newId() };
  const asked = { measureId: world.measureId, expectedVersion: null };
  expect(await requestRun(db, world.editor, asked, starter, at)).toEqual({
    ok: false,
    reason: 'measure_paused',
  });
  expect(await activate(world, world.admin, 3)).toEqual({ ok: true });
  expect(await activationFor(db, world.measureId)).toMatchObject({
    version: 4,
    pausedReason: null,
  });
  const command = ['geo', 'audit', '--url', '{address}', '--format', 'json', '--deep'];
  const moved = await resave(world, 4, { ...targeted, command });
  expect(moved).toMatchObject({ ok: true, value: { status: 'suggested', awaiting: 'trial' } });
  expect((await activationFor(db, world.measureId))?.pausedReason).toBe('changed');
  expect(await activate(world, world.admin, 5)).toEqual({ ok: false, reason: 'trial_required' });
}

async function makesActiveSchedulesActivator(db: Database): Promise<void> {
  const world = await scene(db);
  await trial(world, world.admin);
  const dashboardId = newId();
  await saveDashboard(
    { db, actor: agentOf(world.admin), traceId: newId(), at },
    {
      dashboardId,
      expectedVersion: null,
      jdArea: MEASURE_AREA,
      title: 'Findability',
      slug: 'findability',
      intro: '',
      context: { kind: 'organization', resource_kind: 'website' },
      panels: [{ kind: 'figure', measure: world.measureId, metric: 'average_score' }],
    },
  );
  expect(await activate(world, world.editor, 1, [dashboardId])).toEqual({
    ok: false,
    reason: 'not_permitted',
  });
  expect(await activate(world, world.admin, 1, [dashboardId])).toEqual({ ok: true });
  expect((await measurePageOf(db, world.measureId))?.status).toBe('active');
  expect(await activationFor(db, world.measureId)).toMatchObject({
    version: 2,
    activatorPersonId: world.admin.personId,
    pausedReason: null,
    nextRunAt: at,
  });
  const dashboard = { requestId: newId(), dashboardId, expectedVersion: 2 };
  expect(
    await activateDashboard(
      db,
      world.admin,
      { command: 'activate_dashboard', ...dashboard },
      { traceId: newId(), at },
    ),
  ).toEqual({ ok: false, reason: 'not_permitted' });
}

async function refusesMeasureActiveShares(db: Database): Promise<void> {
  const world = await scene(db);
  const starter = { binding: heldRuns(), traceId: newId() };
  const ask = (actor: Principal, when: Date) =>
    requestRun(db, actor, { measureId: world.measureId, expectedVersion: null }, starter, when);
  expect(await ask(world.admin, at)).toEqual({ ok: false, reason: 'not_permitted' });
  await trial(world, world.admin);
  await activate(world, world.admin);
  expect(await ask(agentOf(world.editor), at)).toMatchObject({ ok: true, state: 'queued' });
  expect(await ask(world.admin, at)).toEqual({ ok: false, reason: 'run_too_soon' });
  expect(await ask(world.stranger, LATER)).toEqual({ ok: false, reason: 'page_not_found' });
  expect(await ask(world.editor, LATER)).toMatchObject({ ok: true });
  expect(starter.binding.started).toHaveLength(2);
}

describe.skipIf(!testServer)('a person runs the trial of a suggested measure', () => {
  it('runs it on the resources of the view and keeps the lock it resolved', () =>
    withAppDatabase(runsResourcesViewKeeps));

  it('refuses an agent, an editor, a stale version and an unwired environment', () =>
    withAppDatabase(refusesAgentEditorStale));

  it('refuses a second trial while one for the same tool is still open', () =>
    withAppDatabase(refusesTrialAlreadyInFlight));
});

describe.skipIf(!testServer)('a person activates a measure after a readable trial', () => {
  it('refuses activation before a trial', () => withAppDatabase(refusesActivationBeforeTrial));

  it('refuses a trial whose output no longer reads with the current values', () =>
    withAppDatabase(refusesTrialWhoseOutput));

  it('makes it active, schedules it as the activator and makes its dashboards active', () =>
    withAppDatabase(makesActiveSchedulesActivator));

  it('rolls the measure back to suggested when a listed dashboard is refused', () =>
    withAppDatabase(rollsBackWhenDashboardRefused));

  it('activates again without a trial after a change that keeps the tool, and not after one that moves it', () =>
    withAppDatabase(reactivatesOnlyWhenToolKept));
});

describe.skipIf(!testServer)('a run is asked for now, at most once an hour', () => {
  it('refuses a measure that is not active, then shares one hourly limit', () =>
    withAppDatabase(refusesMeasureActiveShares));
});
