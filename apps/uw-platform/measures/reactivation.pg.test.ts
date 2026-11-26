import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { systemIdentity, type MeasureFrontmatter, type Principal } from '@uw/contracts';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { collectionsAt, personWith } from '../testing/collections.ts';
import {
  agentOf,
  fakeMeasureSandbox,
  FIRST_DUE,
  geoMeasure,
  geoOutput,
  inlineMeasureRuns,
  MEASURE_AREA,
  measureWorld,
  newId,
  website,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml, postForm } from '../testing/views.ts';
import { activateMeasure } from './activation.ts';
import { activationFor, pauseActivation } from './activations.ts';
import { saveMeasure } from './authoring.ts';
import { runDueMeasures } from './due.ts';
import { measurePageOf } from './measure-pages.ts';
import { observationsOfRun } from './observation-records.ts';
import { requestRun } from './run-now.ts';
import { latestRunOf, runById } from './runs.ts';
import { startTrial } from './trial.ts';

const at = collectionsAt;
const ORIGIN = { origin: 'http://localhost' };

const scored = geoMeasure({
  values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
  metrics: [{ key: 'average_score', name: 'Average score', value: 'score', rule: 'average' }],
});

type Scene = MeasureWorld & { readonly measureId: string };

function runs(world: MeasureWorld) {
  const sandbox = fakeMeasureSandbox(
    new Map([
      ['www.unfoldingword.org', geoOutput(81)],
      ['door43.org', geoOutput(64)],
    ]),
  );
  return inlineMeasureRuns({ db: world.db, files: world.files, sandbox, now: () => at });
}

function save(world: MeasureWorld, measureId: string, expectedVersion: number | null) {
  return (measure: MeasureFrontmatter) =>
    saveMeasure(
      { db: world.db, actor: agentOf(world.admin), traceId: newId(), at },
      {
        measureId,
        expectedVersion,
        jdArea: MEASURE_AREA,
        title: 'GEO score',
        slug: `geo-${measureId.slice(0, 8)}`,
        bodyMd: 'GEO score of our websites.',
        measure,
      },
    );
}

function activate(world: Scene, actor: Principal, version: number) {
  const command = {
    command: 'activate_measure' as const,
    requestId: newId(),
    measureId: world.measureId,
    expectedVersion: version,
    dashboards: [],
  };
  return activateMeasure(world.db, actor, command, { files: world.files, traceId: newId(), at });
}

async function activeScene(db: Database): Promise<Scene> {
  const world = await measureWorld(db);
  await website(world, 'unfoldingWord', 'https://www.unfoldingword.org/');
  await website(world, 'Door43', 'https://door43.org/');
  const measureId = newId();
  const made = await save(world, measureId, null)(scored);
  if (!made.ok) throw new Error(made.reason);
  const command = {
    command: 'run_measure_trial' as const,
    requestId: newId(),
    measureId,
    expectedVersion: 1,
  };
  await startTrial(db, world.admin, command, { binding: runs(world), traceId: newId() }, at);
  const scene = { ...world, measureId };
  const activated = await activate(scene, world.admin, 1);
  if (!activated.ok) throw new Error(activated.reason);
  return scene;
}

function scheduler(world: MeasureWorld) {
  return { binding: runs(world), traceId: newId(), identity: systemIdentity };
}

async function startsFirstRunAtOnce(db: Database): Promise<void> {
  const world = await activeScene(db);
  expect((await activationFor(db, world.measureId))?.nextRunAt).toEqual(at);
  const starter = scheduler(world);
  expect(await runDueMeasures(db, starter, at, 10)).toBe(1);
  const runId = starter.binding.started[0]?.runId ?? '';
  expect(await runById(db, runId)).toMatchObject({ kind: 'scheduled', state: 'ok' });
  const observed = await observationsOfRun(db, runId);
  expect(observed.map((each) => each.values)).toEqual([{ score: 64 }, { score: 81 }]);
}

async function reactivatesAfterLostAccess(db: Database): Promise<void> {
  const world = await activeScene(db);
  const second = await personWith(db, 'measure-admin-2', [{ role: 'admin', area: MEASURE_AREA }]);
  const grant = world.admin.grants.find((each) => each.role === 'admin');
  await revokeSeededGrant(db, grant?.grantId ?? '', new Date(at.getTime() - 1000));
  await runDueMeasures(db, scheduler(world), FIRST_DUE, 10);
  expect((await activationFor(db, world.measureId))?.pausedReason).toBe('activator_lost_access');
  const page = await getHtml(db, second.email ?? '', `/pages/${world.measureId}`);
  const shown = new JSDOM(page.text).window.document;
  const button = shown.querySelector('button[value="activate_measure"]');
  expect(button).not.toBeNull();
  expect(button?.getAttribute('aria-disabled')).toBeNull();
  expect(await activate(world, second, 2)).toEqual({ ok: true });
  expect(await activationFor(db, world.measureId)).toMatchObject({
    version: 2,
    activatorPersonId: second.personId,
    pausedReason: null,
    nextRunAt: at,
  });
  expect(await measurePageOf(db, world.measureId)).toMatchObject({
    status: 'active',
    version: 2,
  });
  const starter = { binding: runs(world), traceId: newId() };
  const asked = { measureId: world.measureId, expectedVersion: null };
  expect(await requestRun(db, world.editor, asked, starter, at)).toMatchObject({ ok: true });
}

async function reactivatesChangedWhileActive(db: Database): Promise<void> {
  const world = await activeScene(db);
  await pauseActivation(db, world.measureId, 'changed');
  expect(await activate(world, world.editor, 2)).toEqual({ ok: false, reason: 'not_permitted' });
  expect(await activate(world, world.admin, 2)).toEqual({ ok: true });
  expect((await activationFor(db, world.measureId))?.pausedReason).toBeNull();
  expect(await activate(world, world.admin, 2)).toEqual({ ok: false, reason: 'not_permitted' });
}

async function restoredActiveMeasureWaits(db: Database): Promise<void> {
  const world = await activeScene(db);
  const email = world.admin.email ?? '';
  const form = new URLSearchParams({ requestId: newId(), expectedVersion: '2' });
  const restored = await postForm(db, email, `/pages/${world.measureId}/versions/1`, form, ORIGIN);
  expect(restored.status).toBe(303);
  expect(await measurePageOf(db, world.measureId)).toMatchObject({
    status: 'suggested',
    version: 3,
  });
  expect((await activationFor(db, world.measureId))?.pausedReason).toBe('changed');
  expect(await activate(world, world.admin, 3)).toEqual({ ok: true });
  expect(await activationFor(db, world.measureId)).toMatchObject({
    version: 4,
    pausedReason: null,
  });
}

async function readsNewestRunOnceTrialExpired(db: Database): Promise<void> {
  const world = await activeScene(db);
  const trial = await latestRunOf(db, world.measureId);
  await runDueMeasures(db, scheduler(world), FIRST_DUE, 10);
  for (const observed of await observationsOfRun(db, trial?.id ?? '')) {
    await world.files.remove(observed.rawKey ?? '');
  }
  const targeted = geoMeasure({
    values: scored.values,
    metrics: [
      { key: 'average_score', name: 'Average score', value: 'score', rule: 'average', target: 90 },
    ],
  });
  expect(await save(world, world.measureId, 2)(targeted)).toMatchObject({
    ok: true,
    value: { awaiting: 'activation' },
  });
  expect(await activate(world, world.admin, 3)).toEqual({ ok: true });
}

describe.skipIf(!testServer)('a person activates a measure again after it pauses', () => {
  it('starts the first scheduled run within a minute of activation', () =>
    withAppDatabase(startsFirstRunAtOnce));

  it('lets another admin activate it again after its activator lost admin', () =>
    withAppDatabase(reactivatesAfterLostAccess));

  it('lets an admin activate again a measure paused as changed while still active', () =>
    withAppDatabase(reactivatesChangedWhileActive));

  it('lands a restored active measure suggested and paused, ready to activate', () =>
    withAppDatabase(restoredActiveMeasureWaits));

  it('re-reads the newest run at the tool when the trial raw output has expired', () =>
    withAppDatabase(readsNewestRunOnceTrialExpired));
});
