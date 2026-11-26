import { randomUUID } from 'node:crypto';
import {
  principalSchema,
  WEBSITES_VIEW_ID,
  type MeasureFrontmatter,
  type Principal,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedRevokedDefaultReading } from '@uw/db/test-seed';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { memoryFiles, type FileStore } from '../pages/file-store.ts';
import { runMeasure } from '../measures/run-measure.ts';
import { activateMeasure } from '../measures/activation.ts';
import { measurePageOf, type MeasurePage } from '../measures/measure-pages.ts';
import { recordObservation } from '../measures/observation-records.ts';
import { rawKeyOf } from '../measures/run-steps.ts';
import { finishRun, insertRun } from '../measures/runs.ts';
import { readValues } from '../measures/values.ts';
import { sha256Hex } from '../pdf/provenance.ts';
import { toolHashOf } from '../measures/tool.ts';
import type { RunDeps } from '../measures/run-steps.ts';
import type {
  MeasureInstallJob,
  MeasureJob,
  MeasureResult,
  MeasureRunBinding,
  MeasureRunStart,
  MeasureSandbox,
} from '../measures/sandbox.ts';
import { collectionsAt, personWith, rowIn } from './collections.ts';
import { personOn } from './kernel.ts';

export const MEASURE_AREA = '00-09';
export const PINNED_LOCK =
  'geo-optimizer-skill==4.19.10 --hash=sha256:2f5d0a8b6e0c4b1e9a7f3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f';

export type FakeOutput = {
  readonly stdout: string;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
  readonly refusedHosts?: readonly string[];
};

export type FakeSandbox = MeasureSandbox & {
  readonly installs: MeasureInstallJob[];
  readonly jobs: MeasureJob[];
  readonly released: string[];
};

function resultOf(output: FakeOutput, lock: string | null): MeasureResult {
  return {
    exitCode: output.exitCode === undefined ? 0 : output.exitCode,
    timedOut: output.timedOut ?? false,
    stdout: output.stdout,
    stderrTail: output.exitCode === undefined ? '' : 'the tool stopped',
    refusedHosts: output.refusedHosts ?? [],
    lock: lock ?? PINNED_LOCK,
    toolVersion: '4.19.10',
  };
}

export function fakeMeasureSandbox(
  outputs: ReadonlyMap<string, FakeOutput>,
  installed: FakeOutput = { stdout: '' },
): FakeSandbox {
  const installs: MeasureInstallJob[] = [];
  const jobs: MeasureJob[] = [];
  const released: string[] = [];
  return {
    installs,
    jobs,
    released,
    install: async (job) => {
      installs.push(job);
      return resultOf(installed, job.lock);
    },
    measure: async (job) => {
      jobs.push(job);
      const output = outputs.get(new URL(job.address).host) ?? { stdout: '', exitCode: 1 };
      return resultOf(output, job.lock);
    },
    release: async (runId) => {
      released.push(runId);
    },
  };
}

export type InlineRuns = MeasureRunBinding & { readonly started: MeasureRunStart[] };

export function inlineMeasureRuns(deps: RunDeps): InlineRuns {
  const started: MeasureRunStart[] = [];
  return {
    started,
    create: async ({ id, params }) => {
      started.push(params);
      await runMeasure(deps, params.runId, (_name, work) => work());
      return { id };
    },
  };
}

export function heldRuns(): InlineRuns {
  const started: MeasureRunStart[] = [];
  return {
    started,
    create: async ({ id, params }) => {
      started.push(params);
      return { id };
    },
  };
}

export function geoOutput(score: number, fixes: readonly string[] = []): FakeOutput {
  return { stdout: JSON.stringify({ score, band: 'good', recommendations: fixes }) };
}

export function geoMeasure(overrides: Partial<MeasureFrontmatter> = {}): MeasureFrontmatter {
  return {
    runtime: 'uvx',
    package: 'geo-optimizer-skill==4.19.10',
    command: ['geo', 'audit', '--url', '{address}', '--format', 'json'],
    resources: { view: WEBSITES_VIEW_ID },
    schedule: { every: 'week', weekday: 1 },
    values: [],
    metrics: [],
    report_card: null,
    ...overrides,
  };
}

export function agentOf(person: Principal): Principal {
  return principalSchema.parse({
    ...person,
    identity: `agent:${person.personId ?? ''}/laptop`,
    kind: 'agent',
    interactive: false,
  });
}

export type MeasureWorld = {
  readonly db: Database;
  readonly admin: Principal;
  readonly editor: Principal;
  readonly stranger: Principal;
  readonly files: FileStore;
};

export async function measureWorld(db: Database): Promise<MeasureWorld> {
  await ensureBuiltIns(db, collectionsAt);
  const admin = await personWith(db, 'measure-admin', [{ role: 'admin', area: MEASURE_AREA }]);
  const editor = await personWith(db, 'measure-editor', [{ role: 'editor', area: MEASURE_AREA }]);
  const outside = await personWith(db, 'measure-stranger', [{ role: 'editor', area: '30-39' }]);
  const strangerId = outside.personId ?? '';
  await seedRevokedDefaultReading(db, strangerId, collectionsAt);
  const stranger = await personOn(db, strangerId, outside.email ?? '', collectionsAt);
  return { db, admin, editor, stranger, files: memoryFiles() };
}

export async function website(
  world: MeasureWorld,
  title: string,
  address: string,
  jdArea: string = MEASURE_AREA,
): Promise<string> {
  return rowIn(world.db, world.admin, {
    collection: 'resource',
    jdArea,
    title,
    values: { kind: 'website', address },
  });
}

export function newId(): string {
  return randomUUID();
}

async function probeTrial(world: MeasureWorld, measure: MeasurePage): Promise<void> {
  const probe = await rowIn(world.db, world.admin, {
    collection: 'resource',
    jdArea: MEASURE_AREA,
    title: `Probe ${measure.id.slice(0, 8)}`,
    values: { kind: 'mobile_app', address: 'https://probe.example.org/' },
  });
  const runId = randomUUID();
  const bytes = new TextEncoder().encode(geoOutput(70).stdout);
  const raw = { key: rawKeyOf(runId, probe), sha256: await sha256Hex(bytes) };
  await world.files.put(raw.key, { bytes, contentType: 'text/plain; charset=utf-8' });
  const read = readValues(geoOutput(70).stdout, measure.measure);
  await insertRun(world.db, {
    id: runId,
    measurePageId: measure.id,
    measureVersion: measure.version,
    toolHash: await toolHashOf(measure.measure),
    kind: 'trial',
    requestedBy: world.admin.identity,
    lock: PINNED_LOCK,
    lockSha256: await sha256Hex(PINNED_LOCK),
    area: measure.jdArea,
    createdAt: collectionsAt,
  });
  await recordObservation(world.db, {
    runId,
    measurePageId: measure.id,
    measureVersion: measure.version,
    resourcePageId: probe,
    observedAt: collectionsAt,
    toolVersion: '4.19.10',
    values: read.ok ? read.values : null,
    reason: read.ok ? null : read.reason,
    raw,
    area: measure.jdArea,
  });
  await finishRun(world.db, runId, 'ok', collectionsAt);
}

export async function forceActive(world: MeasureWorld, measureId: string): Promise<number> {
  const measure = await measurePageOf(world.db, measureId);
  if (measure === null) throw new Error('no measure to make active');
  await probeTrial(world, measure);
  const command = {
    command: 'activate_measure' as const,
    requestId: randomUUID(),
    measureId,
    expectedVersion: measure.version,
    dashboards: [],
  };
  const context = { files: world.files, traceId: randomUUID(), at: collectionsAt };
  const activated = await activateMeasure(world.db, world.admin, command, context);
  if (!activated.ok) throw new Error(`activation refused: ${activated.reason}`);
  return measure.version + 1;
}

export const FIRST_DUE = new Date(Date.UTC(2026, 10, 23, 7));
