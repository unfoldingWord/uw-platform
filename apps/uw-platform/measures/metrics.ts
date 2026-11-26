import type { z } from 'zod';
import type {
  Coverage,
  MeasureValueDefinition,
  MetricDefinition,
  ObservationOutcome,
  ObservationReason,
  ObservedValue,
  ObservedValues,
  verbIo,
} from '@uw/contracts';

export type MetricReply = z.infer<(typeof verbIo)['read_metric']['output']>;
export type MetricFigures = Omit<MetricReply, 'measureId'>;
type ResourceFigure = MetricReply['resources'][number];
type Point = ResourceFigure['points'][number];

export type Observed = {
  readonly observedAt: Date;
  readonly toolVersion: string | null;
  readonly outcome: ObservationOutcome;
  readonly reason: ObservationReason | null;
  readonly values: ObservedValues | null;
};

export type Measured = {
  readonly resourceId: string;
  readonly title: string;
  readonly series: readonly Observed[];
};

export type MetricOf = {
  readonly metric: MetricDefinition;
  readonly value: MeasureValueDefinition;
};

type Condition = NonNullable<MetricDefinition['condition']>;

const MOST_POINTS = 400;
const singular: ReadonlySet<string> = new Set(['latest', 'previous', 'change']);
const PERCENT = 100;

export function valueIn(observed: Observed | undefined, key: string): ObservedValue | null {
  if (observed?.outcome !== 'ok' || observed.values === null) return null;
  return new Map(Object.entries(observed.values)).get(key) ?? null;
}

function numberOf(value: ObservedValue | null): number | null {
  return typeof value === 'number' ? value : null;
}

function meets(value: number, condition: Condition): boolean {
  return condition.op === 'at_least' ? value >= condition.threshold : value <= condition.threshold;
}

type Ruled = {
  readonly value: ObservedValue | null;
  readonly source: Observed | undefined;
  readonly reason: ObservationReason | null;
};

function failureOf(...observed: readonly (Observed | undefined)[]): ObservationReason | null {
  return observed.find((each) => each?.outcome === 'failed')?.reason ?? null;
}

function ruled(of: MetricOf, series: readonly Observed[]): Ruled {
  const key = of.value.key;
  const latest = series.at(-1);
  const previous = series.at(-2);
  if (of.metric.rule === 'previous') {
    return { value: valueIn(previous, key), source: previous, reason: failureOf(previous) };
  }
  if (of.metric.rule !== 'change') {
    return { value: valueIn(latest, key), source: latest, reason: failureOf(latest) };
  }
  const now = numberOf(valueIn(latest, key));
  const before = numberOf(valueIn(previous, key));
  const value = now === null || before === null ? null : now - before;
  return { value, source: latest, reason: value === null ? failureOf(latest, previous) : null };
}

function meetsOf(metric: MetricDefinition, value: ObservedValue | null): boolean | null {
  const number = numberOf(value);
  if (number === null) return null;
  if (metric.target !== undefined) return number >= metric.target;
  return metric.condition === undefined ? null : meets(number, metric.condition);
}

function pointsOf(series: readonly Observed[], key: string): Point[] {
  return series
    .flatMap((observed) => {
      const value = numberOf(valueIn(observed, key));
      if (value === null) return [];
      return [{ at: observed.observedAt.toISOString(), value, toolVersion: observed.toolVersion }];
    })
    .slice(-MOST_POINTS);
}

function resourceFigure(of: MetricOf, measured: Measured): ResourceFigure {
  const { value, source, reason } = ruled(of, measured.series);
  return {
    resourceId: measured.resourceId,
    title: measured.title,
    value,
    observedAt: source === undefined ? null : source.observedAt.toISOString(),
    reason,
    meetsTarget: meetsOf(of.metric, value),
    points: pointsOf(measured.series, of.value.key),
  };
}

function coverageOf(resources: readonly ResourceFigure[]): Coverage {
  const failed = new Map<ObservationReason, number>();
  for (const resource of resources) {
    if (resource.reason !== null)
      failed.set(resource.reason, (failed.get(resource.reason) ?? 0) + 1);
  }
  return {
    scored: resources.filter((resource) => resource.value !== null).length,
    total: resources.length,
    failed: [...failed.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => ({ reason, count })),
  };
}

function mean(numbers: readonly number[]): number {
  return numbers.reduce((total, number) => total + number, 0) / numbers.length;
}

function counted(metric: MetricDefinition, numbers: readonly number[]): number {
  const condition = metric.condition;
  return condition === undefined ? 0 : numbers.filter((number) => meets(number, condition)).length;
}

const sole = (numbers: readonly number[]) => (numbers.length === 1 ? (numbers[0] ?? null) : null);

const figureRules: Readonly<
  Record<
    MetricDefinition['rule'],
    (numbers: readonly number[], metric: MetricDefinition) => number | null
  >
> = {
  latest: sole,
  previous: sole,
  change: sole,
  average: (numbers) => mean(numbers),
  minimum: (numbers) => Math.min(...numbers),
  maximum: (numbers) => Math.max(...numbers),
  count_meeting: (numbers, metric) => counted(metric, numbers),
  share_meeting: (numbers, metric) => (counted(metric, numbers) / numbers.length) * PERCENT,
  over_time: () => null,
};

function figureOf(metric: MetricDefinition, resources: readonly ResourceFigure[]): number | null {
  const numbers = resources.flatMap((resource) => {
    const number = numberOf(resource.value);
    return number === null ? [] : [number];
  });
  if (numbers.length === 0 || (singular.has(metric.rule) && resources.length !== 1)) return null;
  return figureRules[metric.rule](numbers, metric);
}

function asOfOf(resources: readonly ResourceFigure[]): string | null {
  const times = resources.flatMap((resource) =>
    resource.observedAt === null ? [] : [resource.observedAt],
  );
  return times.length === 0 ? null : (times.sort().at(-1) ?? null);
}

function figureUnitOf(of: MetricOf): string | null {
  if (of.metric.rule === 'count_meeting') return null;
  if (of.metric.rule === 'share_meeting' || of.value.type === 'percent') return '%';
  return of.value.unit ?? null;
}

export function metricFigures(of: MetricOf, measured: readonly Measured[]): MetricFigures {
  const resources = measured.map((each) => resourceFigure(of, each));
  return {
    metric: of.metric.key,
    name: of.metric.name,
    rule: of.metric.rule,
    unit: of.value.unit ?? null,
    figureUnit: figureUnitOf(of),
    target: of.metric.target ?? null,
    asOf: asOfOf(resources),
    figure: figureOf(of.metric, resources),
    resources,
    coverage: coverageOf(resources),
  };
}
