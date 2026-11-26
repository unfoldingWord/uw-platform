import { describe, expect, it } from 'vitest';
import type { MeasureValueDefinition, MetricDefinition } from '@uw/contracts';
import { metricFigures, type Measured, type Observed } from './metrics.ts';

const score: MeasureValueDefinition = { key: 'score', name: 'Score', type: 'number', path: '/s' };
const band: MeasureValueDefinition = { key: 'band', name: 'Band', type: 'text', path: '/b' };

function metric(overrides: Partial<MetricDefinition> = {}): MetricDefinition {
  return {
    key: 'average_score',
    name: 'Average score',
    value: 'score',
    rule: 'average',
    ...overrides,
  };
}

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 6));

function ok(n: number, value: number | string, toolVersion = '4.19.10'): Observed {
  const values = typeof value === 'number' ? { score: value } : { band: value };
  return { observedAt: day(n), toolVersion, outcome: 'ok', reason: null, values };
}

function failed(n: number, reason: Observed['reason'] = 'timed_out'): Observed {
  return { observedAt: day(n), toolVersion: null, outcome: 'failed', reason, values: null };
}

function site(id: string, series: readonly Observed[]): Measured {
  return { resourceId: id, title: `Site ${id.slice(0, 1)}`, series };
}

const ids = {
  a: 'a0000000-0000-4000-8000-000000000001',
  b: 'b0000000-0000-4000-8000-000000000002',
  c: 'c0000000-0000-4000-8000-000000000003',
};

const sites: readonly Measured[] = [
  site(ids.a, [ok(1, 70), ok(2, 80)]),
  site(ids.b, [ok(1, 90), failed(2)]),
  site(ids.c, []),
];

describe('ADR 0034 metrics are worked out from observations by a closed set of rules', () => {
  it('averages the latest scores and never turns a failure into zero', () => {
    const figures = metricFigures({ metric: metric({ target: 75 }), value: score }, sites);
    expect(figures.figure).toBe(80);
    expect(figures.coverage).toEqual({
      scored: 1,
      total: 3,
      failed: [{ reason: 'timed_out', count: 1 }],
    });
    expect(figures.resources.map((each) => each.value)).toEqual([80, null, null]);
    expect(figures.resources.map((each) => each.meetsTarget)).toEqual([true, null, null]);
    expect(figures.resources[1]?.reason).toBe('timed_out');
    expect(figures.asOf).toBe(day(2).toISOString());
  });

  it('takes the minimum and the maximum of the latest scores', () => {
    const both = [site(ids.a, [ok(1, 70)]), site(ids.b, [ok(1, 90)])];
    expect(metricFigures({ metric: metric({ rule: 'minimum' }), value: score }, both).figure).toBe(
      70,
    );
    expect(metricFigures({ metric: metric({ rule: 'maximum' }), value: score }, both).figure).toBe(
      90,
    );
  });

  it('counts and shares the sites meeting a condition, over the sites scored', () => {
    const both = [site(ids.a, [ok(1, 70)]), site(ids.b, [ok(1, 90)]), site(ids.c, [failed(1)])];
    const condition = { op: 'at_least', threshold: 80 } as const;
    const counted = metricFigures(
      { metric: metric({ rule: 'count_meeting', condition }), value: score },
      both,
    );
    const shared = metricFigures(
      { metric: metric({ rule: 'share_meeting', condition }), value: score },
      both,
    );
    expect(counted.figure).toBe(1);
    expect(shared.figure).toBe(50);
    expect(counted.resources.map((each) => each.meetsTarget)).toEqual([false, true, null]);
  });
});

describe('ADR 0034 metrics read one value over time, never summing it', () => {
  it('reads the previous value and the change since it', () => {
    const one = [site(ids.a, [ok(1, 70), ok(2, 80)])];
    const previous = metricFigures({ metric: metric({ rule: 'previous' }), value: score }, one);
    const change = metricFigures({ metric: metric({ rule: 'change' }), value: score }, one);
    expect(previous.figure).toBe(70);
    expect(change.figure).toBe(10);
  });

  it('gives one figure for the latest value only when one site is scored', () => {
    const one = metricFigures({ metric: metric({ rule: 'latest' }), value: score }, [sites[0]!]);
    const many = metricFigures({ metric: metric({ rule: 'latest' }), value: score }, sites);
    expect(one.figure).toBe(80);
    expect(many.figure).toBeNull();
  });

  it('keeps a text value per resource and works out no figure from it', () => {
    const texts = [site(ids.a, [ok(1, 'good')])];
    const read = metricFigures(
      { metric: metric({ value: 'band', rule: 'latest' }), value: band },
      texts,
    );
    expect(read.resources[0]?.value).toBe('good');
    expect(read.figure).toBeNull();
  });

  it('gives each resource its points over time with the tool version, for a break', () => {
    const series = [site(ids.a, [ok(1, 70, '4.19.10'), failed(2), ok(3, 60, '5.0.0')])];
    const read = metricFigures({ metric: metric({ rule: 'over_time' }), value: score }, series);
    expect(read.figure).toBeNull();
    expect(read.resources[0]?.points).toEqual([
      { at: day(1).toISOString(), value: 70, toolVersion: '4.19.10' },
      { at: day(3).toISOString(), value: 60, toolVersion: '5.0.0' },
    ]);
  });

  it('answers no figure and no time when nothing was observed', () => {
    const read = metricFigures({ metric: metric(), value: score }, [site(ids.c, [])]);
    expect(read).toMatchObject({ figure: null, asOf: null, coverage: { scored: 0, total: 1 } });
  });
});
