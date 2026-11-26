import type {
  Coverage,
  MeasureAwaiting,
  MeasurePausedReason,
  MeasureRunKind,
  MeasureRunState,
  ObservationReason,
  ObservedValue,
  ValueType,
} from '@uw/contracts';
import { formatFigure } from '@uw/core/money';

const reasonWords: Readonly<Record<ObservationReason, string>> = {
  timed_out: 'timed out',
  tool_failed: 'the tool failed',
  output_not_json: 'the output was not JSON',
  output_unfit: 'the output did not fit the values',
  unreachable: 'the site was unreachable',
  host_refused: 'a host was refused',
};

const pausedWords: Readonly<Record<MeasurePausedReason, string>> = {
  changed: 'Paused: changed since it was activated. It needs a new activation.',
  activator_lost_access: 'Paused: the person who activated it no longer has admin on its area.',
  retired: 'Paused: retired.',
};

const stateWords: Readonly<Record<MeasureRunState, string>> = {
  queued: 'Queued',
  running: 'Running',
  ok: 'Finished',
  partial: 'Finished with failures',
  failed: 'Failed',
  stalled: 'Stopped: no progress for an hour',
  not_wired: 'Not wired here',
};

const kindWords: Readonly<Record<MeasureRunKind, string>> = {
  trial: 'Trial',
  scheduled: 'Scheduled run',
  requested: 'Run now',
};

const awaitingWords: Readonly<Record<MeasureAwaiting, string>> = {
  trial: 'Waiting for a trial',
  activation: 'Waiting for activation',
  nothing: 'Running on its schedule',
};

export function reasonOf(reason: ObservationReason): string {
  return new Map(Object.entries(reasonWords)).get(reason) ?? reason;
}

export function pausedOf(reason: MeasurePausedReason): string {
  return new Map(Object.entries(pausedWords)).get(reason) ?? reason;
}

export function runStateOf(state: MeasureRunState): string {
  return new Map(Object.entries(stateWords)).get(state) ?? state;
}

export function runKindOf(kind: MeasureRunKind): string {
  return new Map(Object.entries(kindWords)).get(kind) ?? kind;
}

export function awaitingOf(awaiting: MeasureAwaiting): string {
  return new Map(Object.entries(awaitingWords)).get(awaiting) ?? awaiting;
}

export function coverageLine(coverage: Coverage): string {
  const failures = coverage.failed.map(
    (each) => `, ${String(each.count)} ${reasonOf(each.reason)}`,
  );
  return `${String(coverage.scored)} of ${String(coverage.total)} scored${failures.join('')}`;
}

export function figureText(value: number, unit: string | null): string {
  if (unit === null) return formatFigure(value);
  return unit === '%' ? `${formatFigure(value)}%` : `${formatFigure(value)} ${unit}`;
}

export function valueText(
  value: ObservedValue | null,
  type: ValueType,
  unit: string | null,
): string {
  if (value === null) return 'Not scored';
  if (typeof value === 'number') return figureText(value, type === 'percent' ? '%' : unit);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return Array.isArray(value) ? value.join(', ') : value;
}
