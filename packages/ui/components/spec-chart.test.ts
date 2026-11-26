import { describe, expect, it } from 'vitest';
import { hasColourLiteral } from '../../../tools/ui/colour-literals.ts';
import { specChartSvg, type SpecChartDrawing } from './spec-chart.tsx';

const days = ['2026-11-24', '2026-11-25', '2026-11-26'];

const runs: SpecChartDrawing = {
  id: 'runs-over-time',
  title: 'Runs per day',
  type: 'bar',
  categories: days,
  series: [{ name: 'Runs', values: [7, 12, 9] }],
  figure: (value) => `${value} runs`,
  notes: [],
};

const flow: SpecChartDrawing = {
  id: 'cumulative-flow',
  title: 'Cumulative flow',
  type: 'stacked_area',
  categories: days,
  series: [
    { name: 'plan', values: [3, 2, 1] },
    { name: 'build', values: [1, 2, 2] },
    { name: 'Done', values: [0, 1, 3] },
  ],
  figure: String,
  notes: [],
};

function cspProblems(svg: string): string[] {
  return [
    ...(/<style\b/i.test(svg) ? ['a style element'] : []),
    ...(/\sstyle="/i.test(svg) ? ['a style attribute'] : []),
    ...(/<script\b/i.test(svg) ? ['a script element'] : []),
    ...(/\son[a-z]+="/i.test(svg) ? ['an event handler attribute'] : []),
    ...(/href="javascript:/i.test(svg) ? ['a script link'] : []),
    ...(hasColourLiteral('chart.svg.html', svg) ? ['a colour literal'] : []),
    ...(svg.includes('token-') ? ['an unmapped token sentinel'] : []),
  ];
}

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((match) => match[1] ?? '');
}

describe('#199 a chart spec draws to SVG that passes the content security policy', () => {
  it.each([
    ['bar', runs],
    ['stacked area', flow],
    ['line', { ...runs, type: 'line' as const }],
  ])(
    '#199 a %s chart carries no style, script, handler, colour literal or sentinel',
    (_kind, drawing) => {
      expect(cspProblems(specChartSvg(drawing))).toEqual([]);
    },
  );

  it('#199 names itself with a title element and an accessible name', () => {
    const svg = specChartSvg(runs);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('role="img" aria-label="Runs per day"');
    expect(svg).toContain('<title>Runs per day</title>');
  });

  it('#199 contains each of its own figures as text', () => {
    const shown = texts(specChartSvg(runs));
    for (const figure of ['7 runs', '12 runs', '9 runs']) expect(shown).toContain(figure);
    const stacked = texts(specChartSvg(flow));
    for (const value of [3, 2, 1, 0]) expect(stacked).toContain(String(value));
  });

  it('#199 starts its value axis at zero, whatever the smallest value', () => {
    const high = { ...runs, series: [{ name: 'Runs', values: [70, 72, 74] }], figure: String };
    expect(texts(specChartSvg({ ...high, type: 'line' }))).toContain('0');
  });
});

describe('#199 a chart spec draws its series, its notes and its text safely', () => {
  it('#199 draws each series in its own token colour and its own dash, in palette order', () => {
    const svg = specChartSvg({ ...flow, type: 'line' });
    expect(svg).toContain('stroke-series-1');
    expect(svg).toContain('stroke-series-2');
    expect(svg).toContain('stroke-series-3');
    expect(svg).toContain('stroke-dasharray');
    expect(specChartSvg(flow)).toContain('fill-series-2');
  });

  it('#199 draws a note, such as staleness, as text inside the picture', () => {
    const note = 'Source behind since 2026-11-26 08:00 UTC';
    const svg = specChartSvg({ ...runs, notes: [note] });
    expect(texts(svg)).toContain(note);
    expect(cspProblems(svg)).toEqual([]);
  });

  it('#199 escapes a hostile title, category, series name and note', () => {
    const hostile = '<img src=x onerror=alert(1)>"&';
    const svg = specChartSvg({
      ...flow,
      title: hostile,
      categories: [hostile, ...days.slice(1)],
      series: [{ name: hostile, values: [1, 2, 3] }],
      notes: [hostile],
    });
    expect(svg).not.toContain('<img');
    expect(cspProblems(svg)).toEqual([]);
  });

  it('#199 draws the same picture twice', () => {
    expect(specChartSvg(flow)).toBe(specChartSvg(flow));
  });
});
