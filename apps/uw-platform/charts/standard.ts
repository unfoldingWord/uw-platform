import type { ChartSpec, StandardChartKey } from '@uw/contracts';

type Params = ChartSpec['query']['params'];

export type StandardChart = {
  readonly key: StandardChartKey;
  readonly scope: 'workflow' | 'team';
  readonly name: string;
  readonly lede: string;
  readonly spec: (params: Params) => ChartSpec;
};

const counted = { x: 'date', y: 'count', currency: null } as const;

function daily(key: StandardChartKey, column: 'runs' | 'gateWaits'): StandardChart {
  const runs = column === 'runs';
  return {
    key,
    scope: 'workflow',
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

const named = { x: 'text', y: 'count', currency: null } as const;

export const teamCharts: readonly StandardChart[] = [
  {
    key: 'commitments_network',
    scope: 'team',
    name: 'Commitments Network',
    lede: 'Who has committed to whom, each arrow from a person to a colleague they named.',
    spec: (params) => ({
      title: 'Commitments network',
      type: 'graph',
      query: { key: 'team_commitments', params },
      encodings: { x: 'from', y: ['entries'], series: null, target: 'to' },
      format: named,
    }),
  },
  {
    key: 'staff_allocation',
    scope: 'team',
    name: 'Staff Allocation',
    lede: 'Each person’s share of time on a program or a portfolio, grouped by portfolio.',
    spec: (params) => ({
      title: 'Staff allocation',
      type: 'bipartite',
      query: { key: 'staff_allocations', params },
      encodings: {
        x: 'person',
        y: ['percent'],
        series: null,
        target: 'target',
        group: 'portfolio',
      },
      format: { x: 'text', y: 'percent', currency: null },
    }),
  },
  {
    key: 'people_and_portfolios',
    scope: 'team',
    name: 'People and Portfolios',
    lede: 'How many people serve each portfolio, by their ring.',
    spec: (params) => ({
      title: 'People and portfolios',
      type: 'bar',
      query: { key: 'people_by_portfolio', params },
      encodings: { x: 'portfolio', y: ['headcount'], series: 'ring' },
      format: named,
    }),
  },
];

const charts: readonly StandardChart[] = [
  daily('runs_over_time', 'runs'),
  daily('waits_over_time', 'gateWaits'),
  {
    key: 'cumulative_flow',
    scope: 'workflow',
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
    scope: 'workflow',
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
    scope: 'workflow',
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
  [...charts, ...teamCharts].map((chart) => [chart.key, chart]),
);

export const workflowCharts: readonly StandardChart[] = charts;

export function standardSpec(key: StandardChartKey, params: Params): ChartSpec {
  const chart = standardCharts.get(key);
  if (chart === undefined) throw new RangeError(`no standard chart ${key}`);
  return chart.spec(params);
}
