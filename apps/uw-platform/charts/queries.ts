import { chartHarnessParamsSchema, type ChartQueryKey } from '@uw/contracts';
import {
  accepted,
  burndown,
  cumulativeFlow,
  cycleTimes,
  daysEnding,
  type ItemHistoryRead,
  type KernelOutcome,
} from '@uw/harness';
import {
  nothingLeftOut,
  preparedWith,
  type ChartColumn,
  type ChartQuery,
  type ChartRow,
  type Excluded,
  type QueryRead,
} from './query-types.ts';
import type { ChartSources } from './sources.ts';
import { teamQueries } from './team-queries.ts';

const HISTORY_SOURCE =
  'harness_events: item_created, stage_advanced and loop_edge_taken, folded per item';

type HarnessRun = (sources: ChartSources, harnessId: string) => Promise<KernelOutcome<QueryRead>>;

function harnessQuery(
  source: string,
  columns: readonly ChartColumn[],
  run: HarnessRun,
): ChartQuery {
  return {
    source,
    columns,
    live: false,
    prepare: (params) =>
      preparedWith(chartHarnessParamsSchema, params, ({ harnessId }) => ({
        harnessId,
        run: (sources) => run(sources, harnessId),
      })),
  };
}

function leftOut(read: ItemHistoryRead): Excluded {
  if (read.unread === 0) return nothingLeftOut;
  const reason = read.capped ? 'history_capped' : 'creation_not_read';
  return { count: read.unread, reasons: [{ reason, count: read.unread }], entries: [] };
}

function historyQuery(
  columns: readonly ChartColumn[],
  rowsOf: (read: ItemHistoryRead, days: readonly string[]) => readonly ChartRow[],
): ChartQuery {
  return harnessQuery(HISTORY_SOURCE, columns, async (sources, harnessId) => {
    const read = await sources.history(harnessId);
    if (read.status === 'error') return read;
    const rows = rowsOf(read.value, daysEnding(sources.at));
    return accepted({ rows, excluded: leftOut(read.value) });
  });
}

const dailyQuery = harnessQuery(
  'agent runs by the day they started, and gate decisions by the day they were made with the items parked at a gate now',
  [
    { key: 'day', label: 'Day' },
    { key: 'runs', label: 'Runs' },
    { key: 'gateWaits', label: 'Gate waits' },
  ],
  async (sources, harnessId) => {
    const read = await sources.daily(harnessId);
    if (read.status === 'error') return read;
    const rows = read.value.map((point) => ({
      day: point.day,
      runs: point.runs,
      gateWaits: point.gateWaits,
    }));
    return accepted({ rows, excluded: nothingLeftOut });
  },
);

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
  ...teamQueries,
]);
