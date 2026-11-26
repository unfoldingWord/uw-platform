import type { ChartSpec, StandardChartKey } from '@uw/contracts';

type Params = ChartSpec['query']['params'];

export type StandardChart = {
  readonly key: StandardChartKey;
  readonly name: string;
  readonly lede: string;
  readonly spec: (params: Params) => ChartSpec;
};

const counted = { x: 'date', y: 'count', currency: null } as const;

function daily(key: StandardChartKey, column: 'runs' | 'gateWaits'): StandardChart {
  const runs = column === 'runs';
  return {
    key,
    name: runs ? 'Runs Over Time' : 'Gate Waits Over Time',
    lede: runs
      ? 'Agent runs started on each of the last 30 days.'
      : 'Gate decisions made on each of the last 30 days, with the items still parked at a gate.',
    spec: (params) => ({
      title: runs ? 'Runs per day' : 'Gate waits per day',
      type: runs ? 'bar' : 'line',
      query: { key: 'daily_runs_and_waits', params },
      encodings: { x: 'day', y: [column], series: null },
      format: counted,
    }),
  };
}

const charts: readonly StandardChart[] = [
  daily('runs_over_time', 'runs'),
  daily('waits_over_time', 'gateWaits'),
  {
    key: 'cumulative_flow',
    name: 'Cumulative Flow',
    lede: 'How many items sat in each stage, and how many were done, at the end of each day.',
    spec: (params) => ({
      title: 'Cumulative flow',
      type: 'stacked_area',
      query: { key: 'item_cumulative_flow', params },
      encodings: { x: 'day', y: ['items'], series: 'stage' },
      format: counted,
    }),
  },
  {
    key: 'cycle_time',
    name: 'Cycle Time',
    lede: 'The median days from an item being created to it being done, by the day it was done.',
    spec: (params) => ({
      title: 'Median cycle time by day done',
      type: 'bar',
      query: { key: 'item_cycle_time', params },
      encodings: { x: 'day', y: ['medianDays'], series: null },
      format: { x: 'date', y: 'days', currency: null },
    }),
  },
  {
    key: 'burndown',
    name: 'Burndown',
    lede: 'How many items were open, created and not yet done, at the end of each day.',
    spec: (params) => ({
      title: 'Open items',
      type: 'line',
      query: { key: 'item_burndown', params },
      encodings: { x: 'day', y: ['open'], series: null },
      format: counted,
    }),
  },
];

export const standardCharts: ReadonlyMap<string, StandardChart> = new Map(
  charts.map((chart) => [chart.key, chart]),
);

export function standardSpec(key: StandardChartKey, params: Params): ChartSpec {
  const chart = standardCharts.get(key);
  if (chart === undefined) throw new RangeError(`no standard chart ${key}`);
  return chart.spec(params);
}
