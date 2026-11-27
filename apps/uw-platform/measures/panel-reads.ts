import type {
  Coverage,
  DashboardContext,
  MeasureRunKind,
  MeasureRunState,
  MeasurePausedReason,
  MeasureValueDefinition,
  MetricContext,
  ObservationReason,
  ObservedValue,
  Panel,
} from '@uw/contracts';
import { activationFor } from './activations.ts';
import type { ContextResource } from './context-resources.ts';
import { readableMeasure, type MeasurePage } from './measure-pages.ts';
import { measuredIn, metricOfMeasure, type Reader } from './metric-reads.ts';
import { metricFigures, valueIn, type Measured, type MetricFigures } from './metrics.ts';
import { latestRunOf } from './runs.ts';

export type ResourceValues = {
  readonly resourceId: string;
  readonly title: string;
  readonly observedAt: string | null;
  readonly reason: ObservationReason | null;
  readonly cells: readonly (ObservedValue | null)[];
};

export type ValuesTable = {
  readonly values: readonly MeasureValueDefinition[];
  readonly rows: readonly ResourceValues[];
  readonly coverage: Coverage;
  readonly asOf: string | null;
};

type RunStatus = {
  readonly state: MeasureRunState;
  readonly kind: MeasureRunKind;
  readonly finishedAt: string | null;
} | null;

export type PanelData =
  | { readonly kind: 'metric'; readonly figures: MetricFigures }
  | { readonly kind: 'values'; readonly table: ValuesTable }
  | {
      readonly kind: 'status';
      readonly table: ValuesTable;
      readonly lastRun: RunStatus;
      readonly nextRunAt: string | null;
      readonly paused: MeasurePausedReason | null;
    };

export type PanelRead = { readonly measure: MeasurePage; readonly data: PanelData | null };

type Loaded = { readonly measure: MeasurePage; readonly measured: readonly Measured[] };

export function metricContextOf(
  context: DashboardContext,
  hostPageId: string | null,
): MetricContext | null {
  if (context.kind !== 'host') return context;
  return hostPageId === null
    ? null
    : { kind: 'page', page_id: hostPageId, descendants: context.descendants };
}

function coverageOf(rows: readonly ResourceValues[]): Coverage {
  const failed = new Map<ObservationReason, number>();
  for (const row of rows)
    if (row.reason !== null) failed.set(row.reason, (failed.get(row.reason) ?? 0) + 1);
  return {
    scored: rows.filter((row) => row.observedAt !== null && row.reason === null).length,
    total: rows.length,
    failed: [...failed.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => ({ reason, count })),
  };
}

function valuesTable(
  measured: readonly Measured[],
  values: readonly MeasureValueDefinition[],
): ValuesTable {
  const rows = measured.map((each) => {
    const latest = each.series.at(-1);
    return {
      resourceId: each.resourceId,
      title: each.title,
      observedAt: latest === undefined ? null : latest.observedAt.toISOString(),
      reason: latest?.outcome === 'failed' ? latest.reason : null,
      cells: values.map((value) => valueIn(latest, value.key)),
    };
  });
  const times = rows.flatMap((row) => (row.observedAt === null ? [] : [row.observedAt]));
  return { values, rows, coverage: coverageOf(rows), asOf: times.sort().at(-1) ?? null };
}

function valuesNamed(
  measure: MeasurePage,
  keys: readonly string[],
): MeasureValueDefinition[] | null {
  const found = keys.map((key) => measure.measure.values.find((value) => value.key === key));
  return found.every((value) => value !== undefined) ? found : null;
}

async function statusOf(reader: Reader, loaded: Loaded): Promise<PanelData> {
  const { measure, measured } = loaded;
  const run = await latestRunOf(reader.db, measure.id);
  const activation = await activationFor(reader.db, measure.id);
  return {
    kind: 'status',
    table: valuesTable(measured, []),
    lastRun:
      run === null
        ? null
        : { state: run.state, kind: run.kind, finishedAt: run.finishedAt?.toISOString() ?? null },
    nextRunAt: activation?.nextRunAt?.toISOString() ?? null,
    paused: activation?.pausedReason ?? null,
  };
}

async function dataOf(reader: Reader, panel: Panel, loaded: Loaded): Promise<PanelData | null> {
  const { measure, measured } = loaded;
  if (panel.kind === 'status') return statusOf(reader, loaded);
  if (panel.kind === 'table' || panel.kind === 'list') {
    const keys =
      panel.kind === 'table' ? panel.values.map((column) => column.value) : [panel.value];
    const values = valuesNamed(measure, keys);
    return values === null ? null : { kind: 'values', table: valuesTable(measured, values) };
  }
  const of = metricOfMeasure(measure, panel.metric);
  return of === null ? null : { kind: 'metric', figures: metricFigures(of, measured) };
}

export type MeasuredOf = (measure: MeasurePage) => Promise<readonly Measured[]>;

export function storedMeasured(reader: Reader, resources: readonly ContextResource[]): MeasuredOf {
  return (measure) => measuredIn(reader.db, measure.id, resources, false);
}

export function panelReader(
  reader: Reader,
  measuredOf: MeasuredOf,
): (panel: Panel) => Promise<PanelRead | null> {
  const cache = new Map<string, Promise<Loaded | null>>();
  const load = async (measureId: string): Promise<Loaded | null> => {
    const measure = await readableMeasure(reader.db, reader.actor, measureId, reader.at);
    if (measure === null) return null;
    return { measure, measured: await measuredOf(measure) };
  };
  return async (panel) => {
    const pending = cache.get(panel.measure) ?? load(panel.measure);
    cache.set(panel.measure, pending);
    const loaded = await pending;
    if (loaded === null) return null;
    return { measure: loaded.measure, data: await dataOf(reader, panel, loaded) };
  };
}
