import { describe, expect, it } from 'vitest';
import {
  chartLineageSchema,
  chartQueryParamsSchemas,
  chartSpecSchema,
  renderChartInputSchema,
  renderedChartSchema,
} from './chart-spec.ts';
import { verbIo } from './verb-io.ts';

const harnessId = '00000000-0000-4000-8000-0000000019a1';

const spec = {
  title: 'Runs per day',
  type: 'bar',
  query: { key: 'daily_runs_and_waits', params: { harnessId } },
  encodings: { x: 'day', y: ['runs'], series: null },
  format: { x: 'date', y: 'count', currency: null },
};

describe('#199 a chart spec names a type, a query, its encodings and its formatting', () => {
  it('#199 accepts a spec and keeps it as given', () => {
    expect(chartSpecSchema.parse(spec)).toEqual(spec);
  });

  it.each([
    ['a type outside the closed set', { ...spec, type: 'pie' }],
    [
      'an encoding that is not a column key',
      { ...spec, encodings: { ...spec.encodings, x: 'Day' } },
    ],
    ['no y encoding', { ...spec, encodings: { ...spec.encodings, y: [] } }],
    ['money with no currency', { ...spec, format: { x: 'date', y: 'money', currency: null } }],
    ['a currency on a count', { ...spec, format: { x: 'date', y: 'count', currency: 'USD' } }],
    ['a query key that is not a word', { ...spec, query: { key: 'DROP TABLE', params: {} } }],
    ['an extra field', { ...spec, script: 'alert(1)' }],
    [
      'more than one measure split by a series',
      { ...spec, encodings: { x: 'day', y: ['runs', 'gateWaits'], series: 'stage' } },
    ],
  ])('#199 refuses %s', (_why, bad) => {
    expect(chartSpecSchema.safeParse(bad).success).toBe(false);
  });

  it('#199 refuses a series over more than one measure at the y encoding, and keeps one measure per series', () => {
    const split = { ...spec, encodings: { x: 'day', y: ['runs', 'gateWaits'], series: 'stage' } };
    const parsed = chartSpecSchema.safeParse(split);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['encodings', 'y']]);
    const one = { ...split, encodings: { ...split.encodings, y: ['runs'] } };
    expect(chartSpecSchema.safeParse(one).success).toBe(true);
    const unsplit = { ...split, encodings: { ...split.encodings, series: null } };
    expect(chartSpecSchema.safeParse(unsplit).success).toBe(true);
  });

  it('#199 keeps a query key off the whitelist parseable, so the platform can refuse it by name', () => {
    const elsewhere = { ...spec, query: { key: 'all_gifts', params: {} } };
    expect(chartSpecSchema.safeParse(elsewhere).success).toBe(true);
  });

  it('#199 types the parameters of every whitelisted workflow query', () => {
    const workflow = [
      'daily_runs_and_waits',
      'item_cumulative_flow',
      'item_cycle_time',
      'item_burndown',
    ] as const;
    for (const params of workflow.map((key) => chartQueryParamsSchemas[key])) {
      expect(params.safeParse({ harnessId }).success).toBe(true);
      expect(params.safeParse({ harnessId: 'nope' }).success).toBe(false);
    }
  });
});

describe('#199 lineage names the source, the time, the filters, what was left out and staleness', () => {
  const lineage = {
    source: 'harness_events',
    query: 'item_cumulative_flow',
    asOf: '2026-11-26T09:00:00.000Z',
    filters: { harnessId },
    excluded: { count: 2, reasons: [{ reason: 'creation_not_read', count: 2 }], entries: [] },
    stale: { since: '2026-11-26T08:00:00.000Z', reason: 'source_behind' },
    capped: null,
  };

  it('#199 accepts lineage with an exclusion and a staleness note', () => {
    expect(chartLineageSchema.parse(lineage)).toEqual(lineage);
  });

  it('#199 refuses an exclusion whose reasons do not add up to its count', () => {
    const wrong = { ...lineage, excluded: { ...lineage.excluded, count: 3 } };
    expect(chartLineageSchema.safeParse(wrong).success).toBe(false);
  });

  it('#199 accepts lineage of a capped read, naming how many of the newest events were read', () => {
    const capped = { ...lineage, capped: { newestEvents: 4999 } };
    expect(chartLineageSchema.parse(capped)).toEqual(capped);
    expect(chartLineageSchema.safeParse({ ...lineage, capped: { newestEvents: 0 } }).success).toBe(
      false,
    );
  });

  it('#199 refuses a staleness reason outside the closed set', () => {
    const wrong = { ...lineage, stale: { since: lineage.asOf, reason: 'gremlins' } };
    expect(chartLineageSchema.safeParse(wrong).success).toBe(false);
  });

  it('#199 a rendered chart is its SVG, its table and its lineage', () => {
    const table = { columns: [{ key: 'day', label: 'Day' }], rows: [{ day: '2026-11-26' }] };
    const rendered = { svg: '<svg></svg>', table, lineage };
    expect(renderedChartSchema.parse(rendered)).toEqual(rendered);
  });
});

describe('#199 render_chart takes a standard chart or a spec, never both', () => {
  const input = verbIo.render_chart.input;

  it('#199 accepts a standard chart with its parameters', () => {
    const standard = { chart: 'cumulative_flow', params: { harnessId }, spec: null };
    expect(input.safeParse(standard).success).toBe(true);
    expect(renderChartInputSchema.safeParse(standard).success).toBe(true);
  });

  it('#199 accepts a spec alone', () => {
    expect(input.safeParse({ chart: null, params: {}, spec }).success).toBe(true);
  });

  it('#199 refuses both, and neither', () => {
    expect(input.safeParse({ chart: 'burndown', params: { harnessId }, spec }).success).toBe(false);
    expect(input.safeParse({ chart: null, params: {}, spec: null }).success).toBe(false);
  });
});
