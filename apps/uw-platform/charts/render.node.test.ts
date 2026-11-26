import { describe, expect, it } from 'vitest';
import {
  chartSpecSchema,
  renderedChartSchema,
  type ChartSpec,
  type RenderedChart,
} from '@uw/contracts';
import { accepted, daysEnding, refused, type ItemHistoryRead } from '@uw/harness';
import { hasColourLiteral } from '../../../tools/ui/colour-literals.ts';
import { csvRows } from '../testing/csv.ts';
import { csvOf } from './csv.ts';
import { drawChart, renderedOf, type ChartSources } from './render.ts';
import { standardSpec } from './standard.ts';

const harnessId = '00000000-0000-4000-8000-0000000019d1';
const at = new Date('2026-11-26T12:00:00.000Z');
const days = daysEnding(at);
const DAY = 86_400_000;

const history: ItemHistoryRead = {
  stages: ['plan', 'build'],
  items: [
    {
      itemId: '00000000-0000-4000-8000-0000000019e1',
      steps: [
        { at: new Date(at.getTime() - 3 * DAY), stage: 'plan' },
        { at: new Date(at.getTime() - 2 * DAY), stage: 'build' },
        { at: new Date(at.getTime() - DAY), stage: null },
      ],
    },
    {
      itemId: '00000000-0000-4000-8000-0000000019e2',
      steps: [{ at: new Date(at.getTime() - 2 * DAY), stage: 'plan' }],
    },
  ],
  unread: 2,
  capped: false,
};

function sources(overrides: Partial<ChartSources> = {}): ChartSources {
  return {
    at,
    daily: async () =>
      accepted(days.map((day, index) => ({ day, runs: index % 4, gateWaits: index % 3 }))),
    history: async () => accepted(history),
    freshness: async () => null,
    ...overrides,
  };
}

function cspProblems(svg: string): string[] {
  return [
    ...(/<style\b|\sstyle="/i.test(svg) ? ['style'] : []),
    ...(/<script\b|\son[a-z]+="/i.test(svg) ? ['script'] : []),
    ...(hasColourLiteral('chart.svg.html', svg) ? ['colour literal'] : []),
  ];
}

async function drawn(spec: ChartSpec, from: ChartSources = sources()) {
  const outcome = await drawChart(from, spec, 'test-chart');
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return renderedOf(outcome.value);
}

const flow = standardSpec('cumulative_flow', { harnessId });

describe('#199 a spec is drawn from a whitelisted query, and only from one', () => {
  it('#199 refuses a spec whose query is not on the whitelist, by its closed-set reason', async () => {
    const spec = chartSpecSchema.parse({ ...flow, query: { key: 'all_gifts', params: {} } });
    const outcome = await drawChart(sources(), spec, 'x');
    expect(outcome).toEqual(refused('chart_query_not_allowed', { query: 'all_gifts' }));
  });

  it('#199 refuses parameters that do not fit the query, naming each field', async () => {
    const spec = { ...flow, query: { key: 'item_burndown', params: { harnessId: 'nope' } } };
    const outcome = await drawChart(sources(), spec, 'x');
    expect(outcome).toEqual(refused('malformed_command', { fields: ['params.harnessId'] }));
  });

  it('#199 refuses an encoding that names no column of the query', async () => {
    const spec = { ...flow, encodings: { x: 'day', y: ['budget'], series: null } };
    const outcome = await drawChart(sources(), spec, 'x');
    expect(outcome).toEqual(refused('chart_encoding_unknown', { fields: ['budget'] }));
  });

  it('#199 passes on the refusal of the source, such as a workflow the reader may not read', async () => {
    const hidden = sources({ history: async () => refused('harness_not_found', { harnessId }) });
    expect((await drawChart(hidden, flow, 'x')).status).toBe('error');
  });
});

describe('#199 every standard chart renders CSP-clean SVG with its own figures, its table and its lineage', () => {
  it.each([
    'runs_over_time',
    'waits_over_time',
    'cumulative_flow',
    'cycle_time',
    'burndown',
  ] as const)('#199 %s', async (key) => {
    const rendered = await drawn(standardSpec(key, { harnessId }));
    expect(renderedChartSchema.safeParse(rendered).success).toBe(true);
    expect(cspProblems(rendered.svg)).toEqual([]);
    expect(rendered.lineage.filters).toEqual({ harnessId });
    expect(rendered.lineage.asOf).toBe(at.toISOString());
  });
});

function rowsAsText(rendered: RenderedChart): string[][] {
  const { columns, rows } = rendered.table;
  const line = (row: RenderedChart['table']['rows'][number]) =>
    columns.map((column) => String(new Map(Object.entries(row)).get(column.key) ?? ''));
  return [columns.map((column) => column.label), ...rows.map(line)];
}

describe('#199 the CSV export of a chart equals the rows the chart drew', () => {
  it('#199 the CSV holds the table, header first, row for row', async () => {
    const rendered = await drawn(flow);
    expect(csvRows(csvOf(rendered.table))).toEqual(rowsAsText(rendered));
  });

  it('#199 each figure the chart draws is a value of a row in that table, as text in the SVG', async () => {
    const rendered = await drawn(standardSpec('burndown', { harnessId }));
    const shown = [...rendered.svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    for (const row of rendered.table.rows) expect(shown).toContain(String(row['open']));
    expect(rendered.table.rows.map((row) => row['day'])).toEqual(days);
  });

  it('#199 the cumulative flow table counts each stage and Done on each day', async () => {
    const rendered = await drawn(flow);
    const today = rendered.table.rows.filter((row) => row['day'] === days.at(-1));
    expect(today).toEqual([
      { day: days.at(-1), stage: 'plan', items: 1 },
      { day: days.at(-1), stage: 'build', items: 0 },
      { day: days.at(-1), stage: 'Done', items: 1 },
    ]);
  });
});

describe('#199 a chart says what it left out and when its source is stale', () => {
  it('#199 reports items whose creation was not read, with the reason, in the lineage and the picture', async () => {
    const rendered = await drawn(flow);
    expect(rendered.lineage.excluded).toEqual({
      count: 2,
      reasons: [{ reason: 'creation_not_read', count: 2 }],
    });
    expect(rendered.svg).toContain('2 items left out');
  });

  it('#199 a chart over a stale source renders its staleness note and keeps it in the lineage', async () => {
    const since = new Date('2026-11-26T08:00:00.000Z');
    const stale = sources({ freshness: async () => ({ since, reason: 'source_behind' }) });
    const rendered = await drawn(standardSpec('runs_over_time', { harnessId }), stale);
    expect(rendered.lineage.stale).toEqual({ since: since.toISOString(), reason: 'source_behind' });
    expect(rendered.svg).toMatch(
      /<text[^>]*>Source behind since 2026-11-26 08:00 UTC[^<]*<\/text>/,
    );
    expect(cspProblems(rendered.svg)).toEqual([]);
  });

  it('#199 a fresh source draws no staleness note', async () => {
    const rendered = await drawn(standardSpec('runs_over_time', { harnessId }));
    expect(rendered.lineage.stale).toBeNull();
    expect(rendered.svg).not.toContain('Source behind');
  });
});
