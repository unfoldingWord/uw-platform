import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { systemIdentity, type MeasureRunKind } from '@uw/contracts';
import { collectionsAt } from '../testing/collections.ts';
import {
  agentOf,
  fakeMeasureSandbox,
  forceActive,
  geoMeasure,
  geoOutput,
  heldRuns,
  MEASURE_AREA,
  measureWorld,
  newId,
  PINNED_LOCK,
  website,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { sha256Hex } from '../pdf/provenance.ts';
import { activationFor } from './activations.ts';
import { saveMeasure } from './authoring.ts';
import { measurePageOf } from './measure-pages.ts';
import { recordObservation } from './observation-records.ts';
import { runMeasure } from './run-measure.ts';
import { claimSlot, failStalledRuns, insertRun, markRunning, runById } from './runs.ts';
import { toolHashOf } from './tool.ts';
import { startTrial } from './trial.ts';

const at = collectionsAt;
const MINUTE_MS = 60_000;
const OLD_LOCK =
  'geo-optimizer-skill==4.19.9 --hash=sha256:1f5d0a8b6e0c4b1e9a7f3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f';

function later(minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE_MS);
}

async function measured(world: MeasureWorld): Promise<string> {
  await website(world, 'unfoldingWord', 'https://www.unfoldingword.org/');
  await website(world, 'Door43', 'https://door43.org/');
  const measureId = newId();
  const made = await saveMeasure(
    { db: world.db, actor: agentOf(world.admin), traceId: newId(), at },
    {
      measureId,
      expectedVersion: null,
      jdArea: MEASURE_AREA,
      title: 'GEO score',
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

type Queued = {
  readonly kind: MeasureRunKind;
  readonly lock: string | null;
  readonly toolHash?: string;
  readonly createdAt?: Date;
};

async function queued(world: MeasureWorld, measureId: string, run: Queued): Promise<string> {
  const measure = await measurePageOf(world.db, measureId);
  if (measure === null) throw new Error('no measure');
  const runId = newId();
  await insertRun(world.db, {
    id: runId,
    measurePageId: measureId,
    measureVersion: measure.version,
    toolHash: run.toolHash ?? (await toolHashOf(measure.measure)),
    kind: run.kind,
    requestedBy: run.kind === 'trial' ? world.admin.identity : systemIdentity,
    lock: run.lock,
    lockSha256: run.lock === null ? null : await sha256Hex(run.lock),
    area: measure.jdArea,
    createdAt: run.createdAt ?? at,
  });
  return runId;
}

function ran(world: MeasureWorld, runId: string) {
  const sandbox = fakeMeasureSandbox(
    new Map([
      ['www.unfoldingword.org', geoOutput(81)],
      ['door43.org', geoOutput(64)],
    ]),
  );
  const deps = { db: world.db, files: world.files, sandbox, now: () => at };
  return { sandbox, state: runMeasure(deps, runId, (_name, work) => work()) };
}

async function stopsRunOfAnotherTool(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  await forceActive(world, measureId);
  const oldLock = await queued(world, measureId, { kind: 'scheduled', lock: OLD_LOCK });
  const first = ran(world, oldLock);
  expect(await first.state).toBe('failed');
  expect(first.sandbox.jobs).toEqual([]);
  const otherTool = await queued(world, measureId, {
    kind: 'requested',
    lock: PINNED_LOCK,
    toolHash: 'a'.repeat(64),
  });
  const second = ran(world, otherTool);
  expect(await second.state).toBe('failed');
  expect(second.sandbox.jobs).toEqual([]);
  expect((await activationFor(db, measureId))?.pausedReason).toBeNull();
  const current = ran(
    world,
    await queued(world, measureId, { kind: 'scheduled', lock: PINNED_LOCK }),
  );
  expect(await current.state).toBe('ok');
  expect(current.sandbox.jobs.map((job) => job.lock)).toEqual([PINNED_LOCK, PINNED_LOCK]);
}

async function replaysPrepareAfterMarkedRunning(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  const runId = await queued(world, measureId, { kind: 'trial', lock: null });
  await markRunning(db, runId, at);
  const replayed = ran(world, runId);
  expect(await replayed.state).toBe('ok');
  expect(replayed.sandbox.jobs).toHaveLength(2);
}

async function failsRunsThatStopped(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  const neverStarted = await queued(world, measureId, { kind: 'trial', lock: null });
  expect(await claimSlot(db, neverStarted, 4, at)).toBe(true);
  const waiting = await queued(world, measureId, { kind: 'trial', lock: null });
  const moving = await queued(world, measureId, { kind: 'trial', lock: null });
  await markRunning(db, moving, at);
  const measure = await measurePageOf(db, measureId);
  await recordObservation(db, {
    runId: moving,
    measurePageId: measureId,
    measureVersion: measure?.version ?? 1,
    resourcePageId: await website(world, 'Probe', 'https://probe.example.org/'),
    observedAt: later(50),
    toolVersion: null,
    values: null,
    reason: 'timed_out',
    raw: null,
    area: MEASURE_AREA,
  });
  expect(await failStalledRuns(db, later(70), 10)).toBe(1);
  expect(await runById(db, neverStarted)).toMatchObject({
    state: 'stalled',
    finishedAt: later(70),
  });
  expect((await runById(db, moving))?.state).toBe('running');
  expect((await runById(db, waiting))?.state).toBe('queued');
  expect(await failStalledRuns(db, later(120), 10)).toBe(1);
  expect((await runById(db, moving))?.state).toBe('stalled');
  expect(await failStalledRuns(db, later(180), 10)).toBe(0);
}

async function startsTrialPastStalledOne(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const measureId = await measured(world);
  const trial = (when: Date) =>
    startTrial(
      db,
      world.admin,
      { command: 'run_measure_trial', requestId: newId(), measureId, expectedVersion: 1 },
      { binding: heldRuns(), traceId: newId() },
      when,
    );
  expect(await trial(at)).toMatchObject({ ok: true, state: 'queued' });
  expect(await trial(later(30))).toEqual({ ok: false, reason: 'request_in_flight' });
  expect(await trial(later(90))).toMatchObject({ ok: true, state: 'queued' });
}

describe.skipIf(!testServer)('a measure run stops when it no longer matches its activation', () => {
  it('measures nothing with a lock or tool other than the activation', () =>
    withAppDatabase(stopsRunOfAnotherTool));

  it('reads the view again when its prepare step is replayed after it started', () =>
    withAppDatabase(replaysPrepareAfterMarkedRunning));
});

describe.skipIf(!testServer)('a run that stopped making progress is closed', () => {
  it('marks a started run stalled once an hour passes without progress, never one waiting for a slot', () =>
    withAppDatabase(failsRunsThatStopped));

  it('lets a new trial start past a trial that stalled', () =>
    withAppDatabase(startsTrialPastStalledOne));
});
