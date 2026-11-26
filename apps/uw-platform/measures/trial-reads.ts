import { measureRunKinds, type ObservationReason, type ObservedValues } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import type { FileStore } from '../pages/file-store.ts';
import { activationFor } from './activations.ts';
import { observationsOfRun, type RunObservation } from './observation-records.ts';
import { usableRunOf, usableTrialOf, type RunRecord } from './runs.ts';
import {
  readValues,
  valueReading,
  type ReadingRule,
  type ValueProblem,
  type ValueReading,
} from './values.ts';

export type SourceRun = {
  readonly runId: string;
  readonly lock: string;
  readonly lockSha256: string;
};

function sourceOf(run: RunRecord | null): SourceRun | null {
  if (run === null || run.lock === null || run.lockSha256 === null) return null;
  return { runId: run.id, lock: run.lock, lockSha256: run.lockSha256 };
}

export async function sourceRunFor(
  db: Executor,
  measureId: string,
  toolHash: string,
): Promise<SourceRun | null> {
  const activation = await activationFor(db, measureId);
  if (activation?.toolHash === toolHash) {
    const newest = sourceOf(await usableRunOf(db, measureId, toolHash, measureRunKinds));
    if (newest !== null) return newest;
  }
  return sourceOf(await usableTrialOf(db, measureId, toolHash));
}

async function rawText(files: FileStore, key: string | null): Promise<string | null> {
  if (key === null) return null;
  const stored = await files.get(key);
  return stored === null ? null : new TextDecoder().decode(stored.bytes);
}

export type CleanRead = 'clean' | 'unreadable' | 'none_readable';

export type Reader = { readonly actor: Principal; readonly at: Date };

export async function readsCleanly(
  db: Executor,
  files: FileStore,
  runId: string,
  rule: ReadingRule & { readonly reader: Reader },
): Promise<CleanRead> {
  const { actor, at } = rule.reader;
  const readable = (await observationsOfRun(db, runId)).filter(
    (each) =>
      each.outcome === 'ok' && can(actor, 'read', { kind: 'area', area: each.resourceArea }, at),
  );
  if (readable.length === 0) return 'none_readable';
  for (const observation of readable) {
    const text = await rawText(files, observation.rawKey);
    if (text === null || !readValues(text, rule).ok) return 'unreadable';
  }
  return 'clean';
}

export type RunReading = {
  readonly resourceId: string;
  readonly title: string;
  readonly resourceArea: string;
  readonly values: ObservedValues;
  readonly problems: readonly ValueProblem[];
  readonly failure: string | null;
};

function partsOf(reading: Extract<ValueReading, { json: true }>) {
  return { values: reading.values, problems: reading.problems, failure: reading.failure };
}

const reportedFailures: ReadonlySet<ObservationReason | null> = new Set([
  'tool_failed',
  'host_refused',
]);

function rereadable(observation: RunObservation, reading: ValueReading | null): boolean {
  if (reading?.json !== true) return false;
  if (observation.outcome === 'ok' || observation.reason === 'output_unfit') return true;
  return reportedFailures.has(observation.reason) && reading.failure !== null;
}

export async function readingsOfRun(
  db: Executor,
  files: FileStore,
  runId: string,
  rule: ReadingRule,
): Promise<readonly RunReading[]> {
  const observed = await observationsOfRun(db, runId);
  const readings: RunReading[] = [];
  for (const observation of observed) {
    const text = await rawText(files, observation.rawKey);
    const reading = text === null ? null : valueReading(text, rule);
    if (reading?.json !== true || !rereadable(observation, reading)) continue;
    const { resourceId, title, resourceArea } = observation;
    readings.push({ resourceId, title, resourceArea, ...partsOf(reading) });
  }
  return readings;
}
