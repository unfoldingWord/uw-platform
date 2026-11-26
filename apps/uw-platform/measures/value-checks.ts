import type { AuthoringProblem, MeasureFrontmatter, ObservationReason } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { FileStore } from '../pages/file-store.ts';
import type { ContextResource } from './context-resources.ts';
import type { MeasurePage } from './measure-pages.ts';
import type { Reader } from './metric-reads.ts';
import type { Measured } from './metrics.ts';
import { seriesOf, type ObservationRow } from './observation-reads.ts';
import { readingsOfRun, sourceRunFor, type RunReading } from './trial-reads.ts';
import { toolHashOf } from './tool.ts';

export type ValueChecker = Reader & { readonly files: FileStore | null };

const MESSAGE_LENGTH = 500;

async function readingsFor(
  checker: ValueChecker,
  measureId: string,
  measure: MeasureFrontmatter,
): Promise<{ readonly runId: string; readonly readings: readonly RunReading[] } | null> {
  if (checker.files === null) return null;
  const source = await sourceRunFor(checker.db, measureId, await toolHashOf(measure));
  if (source === null) return null;
  const all = await readingsOfRun(checker.db, checker.files, source.runId, measure);
  const readings = all.filter((reading) =>
    can(checker.actor, 'read', { kind: 'area', area: reading.resourceArea }, checker.at),
  );
  return { runId: source.runId, readings };
}

function inOutput(reading: RunReading, message: string): string {
  return `In the output for ${reading.title}: ${message}`.slice(0, MESSAGE_LENGTH);
}

function problemsOf(readings: readonly RunReading[], prefix: string): AuthoringProblem[] {
  return readings.flatMap((reading) => [
    ...(reading.failure === null
      ? []
      : [{ path: `${prefix}.failure_path`, message: inOutput(reading, reading.failure) }]),
    ...reading.problems.map((problem) => ({
      path: `${prefix}.values.${String(problem.index)}.path`,
      message: inOutput(reading, problem.message),
    })),
  ]);
}

export async function trialValueProblems(
  checker: ValueChecker,
  measureId: string,
  measure: MeasureFrontmatter,
): Promise<AuthoringProblem[]> {
  const found = await readingsFor(checker, measureId, measure);
  return found === null ? [] : problemsOf(found.readings, 'measure');
}

function rereadReason(row: ObservationRow, reading: RunReading): ObservationReason | null {
  if (reading.failure !== null) return row.reason === 'host_refused' ? row.reason : 'tool_failed';
  return reading.problems.length === 0 ? null : 'output_unfit';
}

function reread(row: ObservationRow, reading: RunReading | undefined): ObservationRow {
  if (reading === undefined) return row;
  const reason = rereadReason(row, reading);
  return {
    ...row,
    outcome: reason === null ? 'ok' : 'failed',
    reason,
    values: reading.failure === null ? reading.values : null,
  };
}

export type PreviewMeasured = {
  readonly measured: readonly Measured[];
  readonly problems: readonly AuthoringProblem[];
};

export async function previewMeasured(
  checker: ValueChecker,
  measure: MeasurePage,
  resources: readonly ContextResource[],
): Promise<PreviewMeasured> {
  const resourceIds = resources.map((resource) => resource.resourceId);
  const series = await seriesOf(checker.db, measure.id, { resourceIds, trials: true });
  const found = await readingsFor(checker, measure.id, measure.measure);
  const inContext = new Set(resourceIds);
  const readings = (found?.readings ?? []).filter((each) => inContext.has(each.resourceId));
  const byResource = new Map(readings.map((reading) => [reading.resourceId, reading]));
  const measured = resources.map((resource) => ({
    resourceId: resource.resourceId,
    title: resource.title,
    series: (series.get(resource.resourceId) ?? []).map((row) =>
      row.runId === found?.runId ? reread(row, byResource.get(resource.resourceId)) : row,
    ),
  }));
  return { measured, problems: problemsOf(readings, `measures.${measure.id}`) };
}
