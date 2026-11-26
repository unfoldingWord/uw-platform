import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { systemIdentity } from '@uw/contracts';
import { collectionsAt } from '../testing/collections.ts';
import {
  agentOf,
  forceActive,
  geoMeasure,
  heldRuns,
  MEASURE_AREA,
  measureWorld,
  newId,
  type InlineRuns,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { activationFor } from './activations.ts';
import { saveMeasure } from './authoring.ts';
import { runDueMeasures } from './due.ts';
import { requestRun } from './run-now.ts';
import { finishRun, latestRunOf, runById } from './runs.ts';
import { MEASURE_RUN_SLOTS } from './sandbox.ts';
import { startTrial } from './trial.ts';

const at = collectionsAt;
const MINUTE_MS = 60_000;

function later(minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE_MS);
}

async function savedMeasure(world: MeasureWorld): Promise<string> {
  const measureId = newId();
  const made = await saveMeasure(
    { db: world.db, actor: agentOf(world.admin), traceId: newId(), at },
    {
      measureId,
      expectedVersion: null,
      jdArea: MEASURE_AREA,
      title: `GEO score ${measureId.slice(0, 4)}`,
      slug: `geo-${measureId.slice(0, 8)}`,
      bodyMd: '',
      measure: geoMeasure({
        values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
      }),
    },
  );
  if (!made.ok) throw new Error(made.reason);
  return measureId;
}

async function activeMeasure(world: MeasureWorld): Promise<string> {
  const measureId = await savedMeasure(world);
  await forceActive(world, measureId);
  return measureId;
}

function scheduler(binding: InlineRuns) {
  return { binding, traceId: newId(), identity: systemIdentity };
}

async function fullSlots(world: MeasureWorld): Promise<InlineRuns> {
  for (let index = 0; index < MEASURE_RUN_SLOTS; index += 1) await activeMeasure(world);
  const binding = heldRuns();
  expect(await runDueMeasures(world.db, scheduler(binding), at, 20)).toBe(MEASURE_RUN_SLOTS);
  return binding;
}

async function queuesTrialAndRunNowUntilSlotFrees(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const scheduled = await fullSlots(world);
  const suggested = await savedMeasure(world);
  const active = await activeMeasure(world);
  const asked = heldRuns();
  const trial = await startTrial(
    db,
    world.admin,
    { command: 'run_measure_trial', requestId: newId(), measureId: suggested, expectedVersion: 1 },
    { binding: asked, traceId: newId() },
    at,
  );
  expect(trial).toMatchObject({ ok: true, state: 'queued' });
  const starter = { binding: asked, traceId: newId() };
  const now = await requestRun(
    db,
    world.editor,
    { measureId: active, expectedVersion: null },
    starter,
    at,
  );
  expect(now).toMatchObject({ ok: true, state: 'queued' });
  expect(asked.started).toEqual([]);
  const cron = heldRuns();
  expect(await runDueMeasures(db, scheduler(cron), later(1), 20)).toBe(0);
  for (const started of scheduled.started.slice(0, 2)) {
    await finishRun(db, started.runId, 'ok', later(2));
  }
  expect(await runDueMeasures(db, scheduler(cron), later(3), 20)).toBe(2);
  const waited = [trial, now].map((each) => (each.ok ? each.runId : ''));
  expect(cron.started.map((each) => each.runId).sort()).toEqual([...waited].sort());
  expect(await runById(db, waited[1] ?? '')).toMatchObject({
    kind: 'requested',
    startedAt: later(3),
  });
  expect((await activationFor(db, active))?.nextRunAt).toEqual(at);
}

function failingRuns(): InlineRuns {
  return {
    started: [],
    create: () => Promise.reject(new Error('the Workflows API is unavailable')),
  };
}

async function retriesFailedScheduledLaunch(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await activeMeasure(world);
  expect(await runDueMeasures(db, scheduler(failingRuns()), later(1), 10)).toBe(0);
  expect(await latestRunOf(db, measureId)).toMatchObject({ kind: 'scheduled', state: 'failed' });
  expect((await activationFor(db, measureId))?.nextRunAt).toEqual(at);
  const held = heldRuns();
  expect(await runDueMeasures(db, scheduler(held), later(2), 10)).toBe(1);
  expect(await runById(db, held.started[0]?.runId ?? '')).toMatchObject({ kind: 'scheduled' });
  expect((await activationFor(db, measureId))?.nextRunAt?.getTime()).toBeGreaterThan(
    later(2).getTime(),
  );
}

async function stopsRetryingAfterAnHour(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await activeMeasure(world);
  expect(await runDueMeasures(db, scheduler(failingRuns()), later(61), 10)).toBe(0);
  expect((await activationFor(db, measureId))?.nextRunAt?.getTime()).toBeGreaterThan(
    later(61).getTime(),
  );
}

describe.skipIf(!testServer)('every run waits for one of the sandbox slots', () => {
  it('leaves a trial and a Run now queued while the slots are full, then the minute job starts them', () =>
    withAppDatabase(queuesTrialAndRunNowUntilSlotFrees));

  it('keeps a scheduled run due when its Workflow cannot be created, and counts it as not started', () =>
    withAppDatabase(retriesFailedScheduledLaunch));

  it('stops retrying a scheduled run an hour after its slot and waits for the next', () =>
    withAppDatabase(stopsRetryingAfterAnHour));
});
