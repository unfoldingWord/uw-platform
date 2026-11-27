import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { systemIdentity, type MeasureFrontmatter } from '@uw/contracts';
import { revokeSeededGrant, seedGrant } from '@uw/db/test-seed';
import { collectionsAt, personWith, rowIn } from '../testing/collections.ts';
import {
  agentOf,
  fakeMeasureSandbox,
  forceActive,
  geoMeasure,
  geoOutput,
  MEASURE_AREA,
  measureWorld,
  newId,
  PINNED_LOCK,
  website,
  type FakeSandbox,
  type MeasureWorld,
} from '../testing/measure-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { sha256Hex } from '../pdf/provenance.ts';
import { activateMeasure } from './activation.ts';
import { activationFor } from './activations.ts';
import { saveMeasure } from './authoring.ts';
import { measurePageOf } from './measure-pages.ts';
import { observationsOfRun } from './observation-records.ts';
import { runMeasure, type MeasureStep } from './run-measure.ts';
import { insertRun } from './runs.ts';
import { toolHashOf } from './tool.ts';

const at = collectionsAt;
const OTHER_AREA = '30-39';
const LONG_ADDRESS = `https://long.example.org/${'a'.repeat(600)}`;

const scored = geoMeasure({
  values: [{ key: 'score', name: 'Score', type: 'number', path: '/score' }],
});

const banded = geoMeasure({
  values: [...scored.values, { key: 'band', name: 'Band', type: 'text', path: '/band' }],
});

function sandboxOf(): FakeSandbox {
  return fakeMeasureSandbox(
    new Map([
      ['a.example.org', geoOutput(81)],
      ['b.example.org', geoOutput(64)],
      ['long.example.org', geoOutput(55)],
    ]),
  );
}

function save(world: MeasureWorld, measureId: string, expectedVersion: number | null) {
  return async (measure: MeasureFrontmatter) => {
    const made = await saveMeasure(
      { db: world.db, actor: agentOf(world.admin), traceId: newId(), at },
      {
        measureId,
        expectedVersion,
        jdArea: MEASURE_AREA,
        title: 'GEO score',
        slug: `geo-${measureId.slice(0, 8)}`,
        bodyMd: '',
        measure,
      },
    );
    if (!made.ok) throw new Error(made.reason);
    return made.value.version;
  };
}

async function activeMeasure(world: MeasureWorld): Promise<string> {
  const measureId = newId();
  await save(world, measureId, null)(scored);
  await forceActive(world, measureId);
  return measureId;
}

async function queued(world: MeasureWorld, measureId: string): Promise<string> {
  const measure = await measurePageOf(world.db, measureId);
  if (measure === null) throw new Error('no measure');
  const runId = newId();
  await insertRun(world.db, {
    id: runId,
    measurePageId: measureId,
    measureVersion: measure.version,
    toolHash: await toolHashOf(measure.measure),
    kind: 'scheduled',
    requestedBy: systemIdentity,
    lock: PINNED_LOCK,
    lockSha256: await sha256Hex(PINNED_LOCK),
    area: measure.jdArea,
    createdAt: at,
  });
  return runId;
}

async function reactivated(world: MeasureWorld, measureId: string): Promise<number> {
  const active = (await measurePageOf(world.db, measureId))?.version ?? 0;
  const edited = await save(world, measureId, active)(banded);
  const command = {
    command: 'activate_measure' as const,
    requestId: newId(),
    measureId,
    expectedVersion: edited,
    dashboards: [],
  };
  const context = { files: world.files, traceId: newId(), at };
  const done = await activateMeasure(world.db, world.admin, command, context);
  if (!done.ok) throw new Error(done.reason);
  return (await measurePageOf(world.db, measureId))?.version ?? 0;
}

type Hooks = Readonly<Record<string, () => Promise<void>>>;

function stepping(log: Map<string, string>, hooks: Hooks = {}): MeasureStep {
  return async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const value = await work();
    log.set(name, JSON.stringify(value));
    await hooks[name]?.();
    return value;
  };
}

function ran(world: MeasureWorld, runId: string, step: MeasureStep, sandbox = sandboxOf()) {
  const deps = { db: world.db, files: world.files, sandbox, now: () => at };
  return runMeasure(deps, runId, step);
}

async function checkpointsOnlyIds(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const a = await website(world, 'Site a', 'https://a.example.org/');
  const b = await website(world, 'Site b', 'https://b.example.org/');
  const runId = await queued(world, await activeMeasure(world));
  const log = new Map<string, string>();
  expect(await ran(world, runId, stepping(log))).toBe('ok');
  const prepared: unknown = JSON.parse(log.get('prepare') ?? 'null');
  expect(prepared).toEqual({ resourceIds: expect.arrayContaining([a, b]) as unknown });
  expect(log.get('prepare')).not.toContain('example.org');
  expect(log.get('prepare')).not.toContain('Site');
}

async function measuresLongAddress(db: Database): Promise<void> {
  const world = await measureWorld(db);
  await website(world, 'Site long', LONG_ADDRESS);
  const runId = await queued(world, await activeMeasure(world));
  const sandbox = sandboxOf();
  expect(await ran(world, runId, stepping(new Map()), sandbox)).toBe('ok');
  expect(sandbox.jobs.map((job) => [job.address, job.command])).toEqual([
    [LONG_ADDRESS, scored.command],
  ]);
  expect((await observationsOfRun(db, runId)).map((each) => each.values)).toEqual([{ score: 55 }]);
}

async function skipsUnreadableResource(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const viewing = randomUUID();
  const personId = world.admin.personId ?? '';
  const grant = { personId, role: 'viewer' as const, scopeKind: 'jd_area' as const };
  const window = { grantedAt: new Date(at.getTime() - 60_000), expiresAt: null };
  await seedGrant(db, { id: viewing, ...grant, scopeArea: OTHER_AREA, ...window });
  const writer = await personWith(db, 'other-writer', [
    { role: 'editor', area: OTHER_AREA },
    { role: 'viewer', area: MEASURE_AREA },
  ]);
  await website(world, 'Site a', 'https://a.example.org/');
  await rowIn(db, writer, {
    collection: 'resource',
    jdArea: OTHER_AREA,
    title: 'Site b',
    values: { kind: 'website', address: 'https://b.example.org/' },
  });
  const runId = await queued(world, await activeMeasure(world));
  const sandbox = sandboxOf();
  const hooks = { install: () => revokeSeededGrant(db, viewing, at) };
  expect(await ran(world, runId, stepping(new Map(), hooks), sandbox)).toBe('partial');
  expect(sandbox.jobs.map((job) => job.address)).toEqual(['https://a.example.org/']);
  expect((await observationsOfRun(db, runId)).map((each) => each.title)).toEqual(['Site a']);
}

async function stopsRunOfEarlierActivation(db: Database): Promise<void> {
  const world = await measureWorld(db);
  await website(world, 'Site a', 'https://a.example.org/');
  const measureId = await activeMeasure(world);
  const runId = await queued(world, measureId);
  const version = await reactivated(world, measureId);
  const sandbox = sandboxOf();
  expect(await ran(world, runId, stepping(new Map()), sandbox)).toBe('failed');
  expect(sandbox.jobs).toEqual([]);
  expect(await observationsOfRun(db, runId)).toEqual([]);
  expect(await activationFor(db, measureId)).toMatchObject({ version, pausedReason: null });
}

async function stopsMidRunOnReactivation(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const a = await website(world, 'Site a', 'https://a.example.org/');
  await website(world, 'Site b', 'https://b.example.org/');
  const measureId = await activeMeasure(world);
  const runId = await queued(world, measureId);
  let version = 0;
  const hooks = {
    [`resource ${a}`]: async () => {
      version = await reactivated(world, measureId);
    },
  };
  const sandbox = sandboxOf();
  expect(await ran(world, runId, stepping(new Map(), hooks), sandbox)).toBe('partial');
  expect(sandbox.jobs.map((job) => job.address)).toEqual(['https://a.example.org/']);
  expect((await observationsOfRun(db, runId)).map((each) => each.title)).toEqual(['Site a']);
  expect(await activationFor(db, measureId)).toMatchObject({ version, pausedReason: null });
}

async function reportsRunStoppedByLostAccess(db: Database): Promise<void> {
  const world = await measureWorld(db);
  const a = await website(world, 'Site a', 'https://a.example.org/');
  await website(world, 'Site b', 'https://b.example.org/');
  const runId = await queued(world, await activeMeasure(world));
  const grant = world.admin.grants.find((each) => each.role === 'admin')?.grantId ?? '';
  const hooks = { [`resource ${a}`]: () => revokeSeededGrant(db, grant, at) };
  expect(await ran(world, runId, stepping(new Map(), hooks))).toBe('partial');
  expect((await observationsOfRun(db, runId)).map((each) => each.outcome)).toEqual(['ok']);
}

async function reportsRunPastExhaustedRecordStep(db: Database): Promise<void> {
  const world = await measureWorld(db);
  await website(world, 'Site a', 'https://a.example.org/');
  const b = await website(world, 'Site b', 'https://b.example.org/');
  const runId = await queued(world, await activeMeasure(world));
  const sandbox = sandboxOf();
  const failing: FakeSandbox = {
    ...sandbox,
    measure: (job) =>
      job.address === 'https://b.example.org/'
        ? Promise.reject(new Error('there is no container instance'))
        : sandbox.measure(job),
  };
  const step = stepping(new Map());
  const exhausted: MeasureStep = (name, work, kind) =>
    name === `failed resource ${b}`
      ? Promise.reject(new Error('the record step ran out of retries'))
      : step(name, work, kind);
  expect(await ran(world, runId, exhausted, failing)).toBe('partial');
  expect((await observationsOfRun(db, runId)).map((each) => each.title)).toEqual(['Site a']);
}

describe.skipIf(!testServer)(
  'a measure run checkpoints ids and reads each resource in its step',
  () => {
    it('keeps only resource ids in the prepare checkpoint', () =>
      withAppDatabase(checkpointsOnlyIds));

    it('hands the sandbox the command template and a long address apart', () =>
      withAppDatabase(measuresLongAddress));

    it('skips a resource the activator can no longer read and records nothing for it', () =>
      withAppDatabase(skipsUnreadableResource));
  },
);

describe.skipIf(!testServer)('a measure run stays bound to the activation it started under', () => {
  it('stops a queued run of an earlier activation without pausing the new one', () =>
    withAppDatabase(stopsRunOfEarlierActivation));

  it('stops a run part way through when its measure is activated again', () =>
    withAppDatabase(stopsMidRunOnReactivation));
});

describe.skipIf(!testServer)('a measure run that leaves resources unmeasured is not ok', () => {
  it('reports a run stopped when the activator lost admin as partial', () =>
    withAppDatabase(reportsRunStoppedByLostAccess));

  it('reports a run whose record step ran out of retries as partial', () =>
    withAppDatabase(reportsRunPastExhaustedRecordStep));
});
