import type { z } from 'zod';
import { REFUSED_HOST_LENGTH, REFUSED_HOSTS_SHOWN, type verbIo } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import type { FileStore } from '../pages/file-store.ts';
import { readableMeasure } from './measure-pages.ts';
import { observationsOfRun, type RunObservation } from './observation-records.ts';
import { outlineOf } from './raw-outline.ts';
import { latestRunOf, runById, type RunRecord } from './runs.ts';
import { valueReading, type ReadingRule } from './values.ts';

export type MeasureRunReply = z.infer<(typeof verbIo)['read_measure_run']['output']>;
type ObservationReply = MeasureRunReply['observations'][number];

export type RunRead = {
  readonly measureId: string;
  readonly runId: string | null;
  readonly resourceId: string | null;
};

type Detail = Pick<
  ObservationReply,
  'raw' | 'rawTruncated' | 'rawLength' | 'outline' | 'outlineMore' | 'problems'
>;

const RAW_LIMIT = 8000;
const OUTLINE_LEAVES = 150;
const DETAILED = 3;

const noDetail = (rawLength: number): Detail => ({
  raw: null,
  rawTruncated: false,
  rawLength,
  outline: null,
  outlineMore: false,
  problems: [],
});

function instantOf(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

async function rawTextOf(files: FileStore | null, key: string | null): Promise<string | null> {
  const stored = key === null || files === null ? null : await files.get(key);
  return stored === null ? null : new TextDecoder().decode(stored.bytes);
}

function problemsIn(text: string, rule: ReadingRule) {
  const reading = valueReading(text, rule);
  if (!reading.json) return [];
  const failure = reading.failure === null ? [] : [reading.failure];
  return [
    ...failure.map((message) => ({ path: 'measure.failure_path', message })),
    ...reading.problems.map((problem) => ({
      path: `measure.values.${String(problem.index)}.path`,
      message: problem.message,
    })),
  ];
}

function detailOf(text: string, rule: ReadingRule): Detail {
  const outline = outlineOf(text, OUTLINE_LEAVES);
  const fits = text.length <= RAW_LIMIT;
  const tail = outline === null && !fits ? text.slice(-RAW_LIMIT) : null;
  return {
    raw: fits ? text : tail,
    rawTruncated: tail !== null,
    rawLength: text.length,
    outline: outline === null ? null : [...outline.leaves],
    outlineMore: outline?.more ?? false,
    problems: problemsIn(text, rule).slice(0, 50),
  };
}

async function observationOf(
  reading: Reading,
  observed: RunObservation,
  detailed: boolean,
): Promise<ObservationReply> {
  const { resourceId, title, outcome, reason, toolVersion, values } = observed;
  const fields = { resourceId, title, outcome, reason, toolVersion, values };
  const text = await rawTextOf(reading.files, observed.rawKey);
  if (text === null) return { ...fields, ...noDetail(0) };
  return { ...fields, ...(detailed ? detailOf(text, reading.rule) : noDetail(text.length)) };
}

type Reading = {
  readonly files: FileStore | null;
  readonly rule: ReadingRule;
};

export type ReadableRun = {
  readonly runObservations: readonly RunObservation[];
  readonly refusedHosts: readonly string[];
};

export async function readableOfRun(
  db: Executor,
  actor: Principal,
  run: RunRecord | null,
  at: Date,
): Promise<ReadableRun> {
  if (run === null) return { runObservations: [], refusedHosts: [] };
  const observed = await observationsOfRun(db, run.id);
  const runObservations = observed.filter((each) =>
    can(actor, 'read', { kind: 'area', area: each.resourceArea }, at),
  );
  const whole = runObservations.length === observed.length;
  return { runObservations, refusedHosts: whole ? run.refusedHosts : [] };
}

function namedHosts(hosts: readonly string[]) {
  const nameable = hosts.filter((host) => host.length <= REFUSED_HOST_LENGTH);
  return {
    refusedHosts: nameable.slice(0, REFUSED_HOSTS_SHOWN),
    refusedHostsMore: nameable.length > REFUSED_HOSTS_SHOWN || nameable.length < hosts.length,
  };
}

function runFields(
  run: RunRecord,
): Omit<MeasureRunReply, 'observations' | 'refusedHosts' | 'refusedHostsMore' | 'detailLimited'> {
  return {
    runId: run.id,
    measureId: run.measurePageId,
    measureVersion: run.measureVersion,
    kind: run.kind,
    state: run.state,
    toolHash: run.toolHash,
    lockSha256: run.lockSha256,
    requestedBy: run.requestedBy,
    createdAt: run.createdAt.toISOString(),
    startedAt: instantOf(run.startedAt),
    finishedAt: instantOf(run.finishedAt),
  };
}

async function chosenRun(db: Executor, read: RunRead): Promise<RunRecord | null> {
  if (read.runId === null) return latestRunOf(db, read.measureId);
  const run = await runById(db, read.runId);
  return run?.measurePageId === read.measureId ? run : null;
}

export async function measureRunFor(
  db: Executor,
  actor: Principal,
  read: RunRead,
  reading: { readonly files: FileStore | null; readonly at: Date },
): Promise<MeasureRunReply | null> {
  const measure = await readableMeasure(db, actor, read.measureId, reading.at);
  if (measure === null) return null;
  const run = await chosenRun(db, read);
  if (run === null) return null;
  const readable = await readableOfRun(db, actor, run, reading.at);
  const chosen = readable.runObservations.filter(
    (each) => read.resourceId === null || each.resourceId === read.resourceId,
  );
  const rule = { files: reading.files, rule: measure.measure };
  const observations: ObservationReply[] = [];
  for (const [index, observed] of chosen.entries()) {
    observations.push(await observationOf(rule, observed, index < DETAILED));
  }
  const detailLimited = chosen.length > DETAILED;
  return {
    ...runFields(run),
    ...namedHosts(readable.refusedHosts),
    detailLimited,
    observations,
  };
}
