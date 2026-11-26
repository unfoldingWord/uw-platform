import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { systemIdentity } from '@uw/contracts';
import { collectionsAt } from '../testing/collections.ts';
import {
  agentOf,
  fakeMeasureSandbox,
  FIRST_DUE,
  forceActive,
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
import { activationFor, pauseActivation } from './activations.ts';
import { saveMeasure } from './authoring.ts';
import { runDueMeasures } from './due.ts';
import { expireMeasureRaw } from './expiry.ts';
import { observationsOfRun } from './observation-records.ts';
import { finishRun, latestRunOf } from './runs.ts';
import { MEASURE_RUN_SLOTS } from './sandbox.ts';
import { runMinuteOf } from './tool.ts';

const at = collectionsAt;

function dueOn(measureId: string, day: number): Date {
  return new Date(Date.UTC(2026, 10, day, 6, runMinuteOf(measureId)));
}

async function activeMeasure(world: MeasureWorld): Promise<string> {
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
  await forceActive(world, measureId);
  return measureId;
}

async function startsScheduledRunPer(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const due = await activeMeasure(world);
  const paused = await activeMeasure(world);
  await pauseActivation(db, paused, 'changed');
  const binding = heldRuns();
  const starter = { binding, traceId: newId(), identity: systemIdentity };
  expect(await runDueMeasures(db, starter, at, 10)).toBe(1);
  expect(await runDueMeasures(db, starter, at, 10)).toBe(0);
  expect((await activationFor(db, due))?.nextRunAt).toEqual(dueOn(due, 23));
  expect(await runDueMeasures(db, starter, dueOn(due, 23), 10)).toBe(1);
  expect(await runDueMeasures(db, starter, dueOn(due, 23), 10)).toBe(0);
  expect(binding.started).toHaveLength(2);
  expect(binding.started.at(-1)?.runId).toBe((await latestRunOf(db, due))?.id);
  expect(await latestRunOf(db, due)).toMatchObject({ kind: 'scheduled', state: 'queued' });
  expect(await latestRunOf(db, paused)).toMatchObject({ kind: 'trial' });
  expect((await activationFor(db, due))?.nextRunAt).toEqual(dueOn(due, 30));
}

async function startsNoMoreThanSlots(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measures: string[] = [];
  for (let index = 0; index < MEASURE_RUN_SLOTS + 2; index += 1) {
    measures.push(await activeMeasure(world));
  }
  const binding = heldRuns();
  const starter = { binding, traceId: newId(), identity: systemIdentity };
  expect(await runDueMeasures(db, starter, at, 20)).toBe(MEASURE_RUN_SLOTS);
  expect(await runDueMeasures(db, starter, at, 20)).toBe(0);
  const waiting = [];
  for (const measureId of measures) {
    const activation = await activationFor(db, measureId);
    if (activation?.nextRunAt?.getTime() === at.getTime()) waiting.push(measureId);
  }
  expect(waiting).toHaveLength(2);
  await finishRun(db, binding.started[0]?.runId ?? '', 'ok', at);
  expect(await runDueMeasures(db, starter, at, 20)).toBe(1);
  expect(binding.started).toHaveLength(MEASURE_RUN_SLOTS + 1);
}

async function startsNothingWhereRun(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const due = await activeMeasure(world);
  const unbound = { binding: null, traceId: newId(), identity: systemIdentity };
  expect(await runDueMeasures(db, unbound, dueOn(due, 23), 10)).toBe(0);
  expect(await latestRunOf(db, due)).toMatchObject({ kind: 'trial' });
}

describe.skipIf(!testServer)('the minute job starts the measures that are due', () => {
  it('starts one scheduled run per due measure and schedules the next', () =>
    withAppDatabase(startsScheduledRunPer));

  it('starts no more runs than the sandbox has room for, and leaves the rest due', () =>
    withAppDatabase(startsNoMoreThanSlots));

  it('starts nothing where the run binding is missing', () =>
    withAppDatabase(startsNothingWhereRun));
});

describe.skipIf(!testServer)(
  'the nightly job deletes raw output older than thirteen months',
  () => {
    it('deletes old raw output and keeps the observation and its values', () =>
      withAppDatabase(async (db) => {
        const world = await measureWorld(db);
        await website(world, 'unfoldingWord', 'https://www.unfoldingword.org/');
        const measureId = await activeMeasure(world);
        const sandbox = fakeMeasureSandbox(new Map([['www.unfoldingword.org', geoOutput(81)]]));
        const binding = inlineMeasureRuns({ db, files: world.files, sandbox, now: () => at });
        const scheduler = { binding, traceId: newId(), identity: systemIdentity };
        await runDueMeasures(db, scheduler, FIRST_DUE, 10);
        const runId = (await latestRunOf(db, measureId))?.id ?? '';
        const [kept] = await observationsOfRun(db, runId);
        const rawKey = kept?.rawKey ?? '';
        expect(await world.files.get(rawKey)).not.toBeNull();
        const soon = new Date(Date.UTC(2027, 10, 20));
        expect(await expireMeasureRaw(db, world.files, soon)).toBe(0);
        const later = new Date(Date.UTC(2027, 11, 22));
        expect(await expireMeasureRaw(db, world.files, later)).toBe(2);
        expect(await world.files.get(rawKey)).toBeNull();
        const [after] = await observationsOfRun(db, runId);
        expect(after).toMatchObject({ outcome: 'ok', values: { score: 81 }, rawKey: null });
      }));
  },
);
