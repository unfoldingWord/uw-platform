import {
  chartQueryKeySchema,
  type ChartLineage,
  type ChartQueryKey,
  type ChartSpec,
  type ChartTable,
  type RenderedChart,
} from '@uw/contracts';
import { accepted, refused, type KernelOutcome } from '@uw/harness';
import { specChartSvg, type SpecChartDrawing } from '@uw/ui/components/spec-chart.tsx';
import { drawingOf, notesOf } from './drawing.ts';
import { chartQueries, type ChartQuery } from './queries.ts';
import type { ChartSources } from './sources.ts';

export type { ChartSources } from './sources.ts';

export type DrawnChart = {
  readonly spec: ChartSpec;
  readonly table: ChartTable;
  readonly lineage: ChartLineage;
  readonly drawing: SpecChartDrawing;
};

type Checked = {
  readonly key: ChartQueryKey;
  readonly query: ChartQuery;
  readonly harnessId: string;
};

function fieldsOf(issues: readonly { readonly path: readonly PropertyKey[] }[]): string[] {
  return [...new Set(issues.map((issue) => ['params', ...issue.path.map(String)].join('.')))];
}

export function checkedSpec(spec: ChartSpec): KernelOutcome<Checked> {
  const key = chartQueryKeySchema.safeParse(spec.query.key);
  const query = key.success ? chartQueries.get(key.data) : undefined;
  if (!key.success || query === undefined) {
    return refused('chart_query_not_allowed', { query: spec.query.key });
  }
  const params = query.params.safeParse(spec.query.params);
  if (!params.success)
    return refused('malformed_command', { fields: fieldsOf(params.error.issues) });
  const known = new Set(query.columns.map((column) => column.key));
  const series = spec.encodings.series === null ? [] : [spec.encodings.series];
  const named = [spec.encodings.x, ...spec.encodings.y, ...series];
  const unknown = [...new Set(named.filter((key) => !known.has(key)))];
  if (unknown.length > 0) return refused('chart_encoding_unknown', { fields: unknown });
  return accepted({ key: key.data, query, harnessId: params.data.harnessId });
}

function filtersOf(params: ChartSpec['query']['params']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );
}

export async function drawChart(
  sources: ChartSources,
  spec: ChartSpec,
  id: string,
): Promise<KernelOutcome<DrawnChart>> {
  const checked = checkedSpec(spec);
  if (checked.status === 'error') return checked;
  const { key, query, harnessId } = checked.value;
  const read = await query.run(sources, { harnessId });
  if (read.status === 'error') return read;
  const stale = await sources.freshness();
  const lineage: ChartLineage = {
    source: query.source,
    query: key,
    asOf: sources.at.toISOString(),
    filters: filtersOf(spec.query.params),
    excluded: { count: read.value.excluded.count, reasons: [...read.value.excluded.reasons] },
    stale: stale === null ? null : { since: stale.since.toISOString(), reason: stale.reason },
  };
  const table = { columns: [...query.columns], rows: read.value.rows.map((row) => ({ ...row })) };
  const drawing = drawingOf({ id, spec, ...table, notes: notesOf(lineage) });
  return accepted({ spec, table, lineage, drawing });
}

export function renderedOf(drawn: DrawnChart): RenderedChart {
  return { svg: specChartSvg(drawn.drawing), table: drawn.table, lineage: drawn.lineage };
}
