import {
  chartHarnessParamsSchema,
  type ChartExcludedReason,
  type ChartQueryKey,
} from '@uw/contracts';
import {
  accepted,
  burndown,
  cumulativeFlow,
  cycleTimes,
  daysEnding,
  type ItemHistoryRead,
  type KernelOutcome,
} from '@uw/harness';
import type { z } from 'zod';
import type { ChartSources } from './sources.ts';

export type ChartCell = string | number | null;
export type ChartRow = Readonly<Record<string, ChartCell>>;
export function cellOf(row: ChartRow, key: string): ChartCell {
  return new Map(Object.entries(row)).get(key) ?? null;
}

export type ChartColumn = { readonly key: string; readonly label: string };
type Excluded = {
  readonly count: number;
  readonly reasons: readonly { readonly reason: ChartExcludedReason; readonly count: number }[];
};
type QueryRead = { readonly rows: readonly ChartRow[]; readonly excluded: Excluded };
type Params = z.infer<typeof chartHarnessParamsSchema>;

export type ChartQuery = {
  readonly params: typeof chartHarnessParamsSchema;
  readonly source: string;
  readonly columns: readonly ChartColumn[];
  run(sources: ChartSources, params: Params): Promise<KernelOutcome<QueryRead>>;
};

const nothingLeftOut: Excluded = { count: 0, reasons: [] };
const HISTORY_SOURCE =
  'harness_events: item_created, stage_advanced and loop_edge_taken, folded per item';

function leftOut(read: ItemHistoryRead): Excluded {
  if (read.unread === 0) return nothingLeftOut;
  const reason = read.capped ? 'history_capped' : 'creation_not_read';
  return { count: read.unread, reasons: [{ reason, count: read.unread }] };
}

function historyQuery(
  columns: readonly ChartColumn[],
  rowsOf: (read: ItemHistoryRead, days: readonly string[]) => readonly ChartRow[],
): ChartQuery {
  return {
    params: chartHarnessParamsSchema,
    source: HISTORY_SOURCE,
    columns,
    run: async (sources, params) => {
      const read = await sources.history(params.harnessId);
      if (read.status === 'error') return read;
      const rows = rowsOf(read.value, daysEnding(sources.at));
      return accepted({ rows, excluded: leftOut(read.value) });
    },
  };
}

const dailyQuery: ChartQuery = {
  params: chartHarnessParamsSchema,
  source:
    'agent runs by the day they started, and gate decisions by the day they were made with the items parked at a gate now',
  columns: [
    { key: 'day', label: 'Day' },
    { key: 'runs', label: 'Runs' },
    { key: 'gateWaits', label: 'Gate waits' },
  ],
  run: async (sources, params) => {
    const read = await sources.daily(params.harnessId);
    if (read.status === 'error') return read;
    const rows = read.value.map((point) => ({
      day: point.day,
      runs: point.runs,
      gateWaits: point.gateWaits,
    }));
    return accepted({ rows, excluded: nothingLeftOut });
  },
};

const flowQuery = historyQuery(
  [
    { key: 'day', label: 'Day' },
    { key: 'stage', label: 'Stage' },
    { key: 'items', label: 'Items' },
  ],
  (read, days) =>
    cumulativeFlow(read, days).map((row) => ({
      day: row.day,
      stage: row.stage ?? 'Done',
      items: row.items,
    })),
);

const cycleQuery = historyQuery(
  [
    { key: 'day', label: 'Day' },
    { key: 'finished', label: 'Finished' },
    { key: 'medianDays', label: 'Median days' },
  ],
  (read, days) => cycleTimes(read.items, days).map((row) => ({ ...row })),
);

const burndownQuery = historyQuery(
  [
    { key: 'day', label: 'Day' },
    { key: 'open', label: 'Open items' },
  ],
  (read, days) => burndown(read.items, days).map((row) => ({ ...row })),
);

export const chartQueries: ReadonlyMap<ChartQueryKey, ChartQuery> = new Map<
  ChartQueryKey,
  ChartQuery
>([
  ['daily_runs_and_waits', dailyQuery],
  ['item_cumulative_flow', flowQuery],
  ['item_cycle_time', cycleQuery],
  ['item_burndown', burndownQuery],
]);
