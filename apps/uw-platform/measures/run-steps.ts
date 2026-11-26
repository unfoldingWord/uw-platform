import type {
  MeasureRunKind,
  MeasureRunState,
  ObservationReason,
  ObservedValues,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import type { FileStore } from '../pages/file-store.ts';
import { sha256Hex } from '../pdf/provenance.ts';
import { authorityOfRun, type RunAuthority } from './authority-of-run.ts';
import type { MeasurePage } from './measure-pages.ts';
import { observationsOfRun, observedIn, recordObservation } from './observation-records.ts';
import { readableResource, resourceIdsOfView, type MeasuredResource } from './resources.ts';
import {
  addRefusedHosts,
  finishRun,
  markRunning,
  recordLock,
  runById,
  type RunRecord,
} from './runs.ts';
import {
  MEASURE_OUTPUT_LIMIT_BYTES,
  MEASURE_TIMEOUT_MS,
  type MeasureResult,
  type MeasureSandbox,
} from './sandbox.ts';
import { measurableAddress } from './tool.ts';
import { valueReading } from './values.ts';

export type RunDeps = {
  readonly db: Executor;
  readonly files: FileStore;
  readonly sandbox: MeasureSandbox;
  readonly now: () => Date;
};

export type Prepared = { readonly resourceIds: readonly string[] };
export type Observed = 'ok' | 'failed' | 'kept' | 'skipped' | 'stopped';
export type RunInstall =
  | { readonly state: 'installed' | 'stopped' }
  | { readonly state: 'failed'; readonly result: MeasureResult };

type Authorized = Extract<RunAuthority, { ok: true }>;
type Opened = {
  readonly run: RunRecord;
  readonly authority: Authorized;
  readonly resource: MeasuredResource;
};

const TRIAL_RESOURCES = 3;
export const MOST_MEASURED_RESOURCES = 500;
const RAW_TYPE = 'text/plain; charset=utf-8';

type Outcome = {
  readonly values: ObservedValues | null;
  readonly reason: ObservationReason | null;
};

export function rawKeyOf(runId: string, resourceId: string): string {
  return `measures/raw/${runId}/${resourceId}.json`;
}

export async function prepareRun(deps: RunDeps, runId: string): Promise<Prepared> {
  const run = await runById(deps.db, runId);
  if (run === null || (run.state !== 'queued' && run.state !== 'running')) {
    return { resourceIds: [] };
  }
  const at = deps.now();
  const authority = await authorityOfRun(deps.db, run, at);
  if (!authority.ok) return { resourceIds: [] };
  const most = run.kind === 'trial' ? TRIAL_RESOURCES : MOST_MEASURED_RESOURCES;
  const viewId = authority.measure.measure.resources.view;
  const resourceIds = await resourceIdsOfView(deps.db, authority.actor, { viewId, most }, at);
  await markRunning(deps.db, runId, at);
  return { resourceIds };
}

function failed(reason: ObservationReason): Outcome {
  return { values: null, reason };
}

function readOutcome(result: MeasureResult, measure: MeasurePage, kind: MeasureRunKind): Outcome {
  const reading = valueReading(result.stdout, measure.measure);
  if (!reading.json) return failed('output_not_json');
  if (reading.failure !== null) return failed(refusalOr(result, 'tool_failed'));
  if (kind === 'trial' || reading.problems.length === 0) {
    return { values: reading.values, reason: null };
  }
  return failed('output_unfit');
}

function refusalOr(result: MeasureResult, reason: ObservationReason): ObservationReason {
  return result.refusedHosts.length > 0 ? 'host_refused' : reason;
}

function outcomeOf(result: MeasureResult | null, run: RunRecord, measure: MeasurePage): Outcome {
  if (result === null || (result.exitCode === null && !result.timedOut))
    return failed('unreachable');
  if (result.timedOut) return failed('timed_out');
  if (result.exitCode !== 0) return failed(refusalOr(result, 'tool_failed'));
  return readOutcome(result, measure, run.kind);
}

function rawTextOf(result: MeasureResult, outcome: Outcome): string {
  const json = result.exitCode === 0 && !result.timedOut && outcome.reason !== 'output_not_json';
  if (json || result.stderrTail === '') return result.stdout;
  return `${result.stdout}\n--- stderr ---\n${result.stderrTail}`;
}

function measured(
  deps: RunDeps,
  run: RunRecord,
  authority: Authorized,
  address: string,
): Promise<MeasureResult> {
  const { measure } = authority.measure;
  return deps.sandbox.measure({
    runId: run.id,
    runtime: measure.runtime,
    packageSpec: measure.package,
    lock: authority.lock,
    command: measure.command,
    address,
    timeoutMs: MEASURE_TIMEOUT_MS,
    outputLimitBytes: MEASURE_OUTPUT_LIMIT_BYTES,
  });
}

function resultFor(
  deps: RunDeps,
  run: RunRecord,
  authority: Authorized,
  resource: MeasuredResource,
  install: RunInstall,
): Promise<MeasureResult | null> {
  if (install.state === 'failed') return Promise.resolve(install.result);
  if (!measurableAddress(resource.address)) return Promise.resolve(null);
  return measured(deps, run, authority, resource.address);
}

async function keptRaw(deps: RunDeps, key: string, text: string) {
  const bytes = new TextEncoder().encode(text);
  await deps.files.put(key, { bytes, contentType: RAW_TYPE });
  return { key, sha256: await sha256Hex(bytes), length: text.length };
}

async function keepLock(deps: RunDeps, run: RunRecord, result: MeasureResult): Promise<void> {
  if (run.lock !== null || result.lock === '') return;
  await recordLock(deps.db, run.id, {
    lock: result.lock,
    lockSha256: await sha256Hex(result.lock),
  });
}

async function observe(
  deps: RunDeps,
  run: RunRecord,
  authority: Authorized,
  resource: MeasuredResource,
  install: RunInstall,
): Promise<Observed> {
  const result = await resultFor(deps, run, authority, resource, install);
  const outcome = outcomeOf(result, run, authority.measure);
  const raw =
    result === null
      ? null
      : await keptRaw(deps, rawKeyOf(run.id, resource.resourceId), rawTextOf(result, outcome));
  if (result !== null) await keepLock(deps, run, result);
  await recordObservation(deps.db, {
    runId: run.id,
    measurePageId: run.measurePageId,
    measureVersion: authority.measure.version,
    resourcePageId: resource.resourceId,
    observedAt: deps.now(),
    toolVersion: result?.toolVersion ?? null,
    ...outcome,
    raw,
    area: authority.measure.jdArea,
  });
  await addRefusedHosts(deps.db, run.id, result?.refusedHosts ?? []);
  return outcome.reason === null ? 'ok' : 'failed';
}

export async function installRun(deps: RunDeps, runId: string): Promise<RunInstall> {
  const run = await runById(deps.db, runId);
  if (run === null || run.state !== 'running') return { state: 'stopped' };
  const authority = await authorityOfRun(deps.db, run, deps.now());
  if (!authority.ok) return { state: 'stopped' };
  const { runtime, package: packageSpec } = authority.measure.measure;
  const result = await deps.sandbox.install({ runId, runtime, packageSpec, lock: authority.lock });
  await addRefusedHosts(deps.db, runId, result.refusedHosts);
  if (result.exitCode !== 0 || result.timedOut) return { state: 'failed', result };
  await keepLock(deps, run, result);
  return { state: 'installed' };
}

async function opened(
  deps: RunDeps,
  runId: string,
  resourceId: string,
): Promise<Opened | Observed> {
  const run = await runById(deps.db, runId);
  if (run === null || run.state !== 'running') return 'skipped';
  if (await observedIn(deps.db, runId, resourceId)) return 'kept';
  const at = deps.now();
  const authority = await authorityOfRun(deps.db, run, at);
  if (!authority.ok) return 'stopped';
  const resource = await readableResource(deps.db, authority.actor, resourceId, at);
  return resource === null ? 'skipped' : { run, authority, resource };
}

export async function observeResource(
  deps: RunDeps,
  runId: string,
  resourceId: string,
  install: RunInstall,
): Promise<Observed> {
  if (install.state === 'stopped') return 'stopped';
  const open = await opened(deps, runId, resourceId);
  if (typeof open === 'string') return open;
  return observe(deps, open.run, open.authority, open.resource, install);
}

export async function failedStep(
  deps: RunDeps,
  runId: string,
  resourceId: string,
): Promise<Observed> {
  const open = await opened(deps, runId, resourceId);
  if (typeof open === 'string') return open;
  const { run, authority } = open;
  await recordObservation(deps.db, {
    runId,
    measurePageId: run.measurePageId,
    measureVersion: authority.measure.version,
    resourcePageId: resourceId,
    observedAt: deps.now(),
    toolVersion: null,
    values: null,
    reason: 'tool_failed',
    raw: null,
    area: authority.measure.jdArea,
  });
  return 'failed';
}

export async function releaseRun(deps: RunDeps, runId: string): Promise<boolean> {
  try {
    await deps.sandbox.release(runId);
    return true;
  } catch {
    return false;
  }
}

export async function finishMeasureRun(
  db: Executor,
  runId: string,
  planned: number,
  at: Date,
): Promise<MeasureRunState> {
  const observed = await observationsOfRun(db, runId);
  const ok = observed.filter((each) => each.outcome === 'ok').length;
  const state: MeasureRunState = ok === 0 ? 'failed' : ok >= planned ? 'ok' : 'partial';
  await finishRun(db, runId, state, at);
  return (await runById(db, runId))?.state ?? state;
}

export async function unwiredRun(db: Executor, runId: string, at: Date): Promise<MeasureRunState> {
  await finishRun(db, runId, 'not_wired', at);
  return (await runById(db, runId))?.state ?? 'not_wired';
}
