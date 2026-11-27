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
import { drawingOf, notesOf, lineageLines } from './drawing.ts';
import { chartQueries } from './queries.ts';
import type { ChartQuery, PreparedQuery } from './query-types.ts';
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
  readonly prepared: PreparedQuery;
  readonly harnessId: string | null;
};

function encodedColumns(spec: ChartSpec): readonly string[] {
  const { encodings } = spec;
  const optional = [encodings.series, encodings.target, encodings.group];
  const named = optional.filter((key): key is string => key !== null && key !== undefined);
  return [encodings.x, ...encodings.y, ...named];
}

export function checkedSpec(spec: ChartSpec): KernelOutcome<Checked> {
  const key = chartQueryKeySchema.safeParse(spec.query.key);
  const query = key.success ? chartQueries.get(key.data) : undefined;
  if (!key.success || query === undefined) {
    return refused('chart_query_not_allowed', { query: spec.query.key });
  }
  const prepared = query.prepare(spec.query.params);
  if (prepared.status === 'error') return prepared;
  const known = new Set(query.columns.map((column) => column.key));
  const unknown = [...new Set(encodedColumns(spec).filter((name) => !known.has(name)))];
  if (unknown.length > 0) return refused('chart_encoding_unknown', { fields: unknown });
  const { harnessId } = prepared.value;
  return accepted({ key: key.data, query, prepared: prepared.value, harnessId });
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
  const { key, query, prepared } = checked.value;
  const read = await prepared.run(sources);
  if (read.status === 'error') return read;
  const stale = query.live ? null : await sources.freshness();
  const { excluded } = read.value;
  const lineage: ChartLineage = {
    source: query.source,
    query: key,
    asOf: sources.at.toISOString(),
    filters: filtersOf(spec.query.params),
    excluded: {
      count: excluded.count,
      reasons: [...excluded.reasons],
      entries: [...excluded.entries],
    },
    stale: stale === null ? null : { since: stale.since.toISOString(), reason: stale.reason },
    capped: read.value.capped ?? null,
  };
  const table = { columns: [...query.columns], rows: read.value.rows.map((row) => ({ ...row })) };
  const drawing = drawingOf({ id, spec, ...table, notes: notesOf(lineage) });
  return accepted({ spec, table, lineage, drawing });
}

export function renderedOf(drawn: DrawnChart): RenderedChart {
  return { svg: specChartSvg(drawn.drawing), table: drawn.table, lineage: drawn.lineage };
}

export function exportedSvg(drawn: DrawnChart): string {
  const { drawing, lineage } = drawn;
  return specChartSvg({ ...drawing, notes: [...drawing.notes, ...lineageLines(lineage)] });
}
