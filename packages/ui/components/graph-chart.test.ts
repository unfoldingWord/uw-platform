import { describe, expect, it } from 'vitest';
import { hasColourLiteral } from '../../../tools/ui/colour-literals.ts';
import { specChartSvg, type SpecChartDrawing } from './spec-chart.tsx';

const base = { categories: [], series: [], figure: String, notes: [] };

const network: SpecChartDrawing = {
  ...base,
  id: 'commitments',
  title: 'Commitments network',
  type: 'graph',
  graph: {
    layout: 'circle',
    nodes: ['Ada Example', 'Lee-Anne Placeholder', 'Sam Sample'].map((name) => ({
      id: name,
      name,
      side: 'source',
      group: null,
    })),
    edges: [
      { from: 'Ada Example', to: 'Sam Sample', label: null },
      { from: 'Sam Sample', to: 'Ada Example', label: null },
      { from: 'Ada Example', to: 'Lee-Anne Placeholder', label: null },
    ],
    groups: [],
  },
};

const allocation: SpecChartDrawing = {
  ...base,
  id: 'allocation',
  title: 'Staff allocation',
  type: 'bipartite',
  notes: ['Left out: Sam Sample on a page you cannot read.'],
  graph: {
    layout: 'columns',
    nodes: [
      { id: 'Ada Example', name: 'Ada Example', side: 'source', group: null },
      { id: 'Program Alpha', name: 'Program Alpha', side: 'target', group: 'Portfolio One' },
      { id: 'Portfolio Two', name: 'Portfolio Two', side: 'target', group: 'Portfolio Two' },
    ],
    edges: [
      { from: 'Ada Example', to: 'Program Alpha', label: '60%' },
      { from: 'Ada Example', to: 'Portfolio Two', label: 'unspecified' },
    ],
    groups: ['Portfolio One', 'Portfolio Two'],
  },
};

function cspProblems(svg: string): string[] {
  return [
    ...(/<style\b|\sstyle="/i.test(svg) ? ['style'] : []),
    ...(/<script\b|\son[a-z]+="/i.test(svg) ? ['script'] : []),
    ...(hasColourLiteral('chart.svg.html', svg) ? ['a colour literal'] : []),
    ...(svg.includes('token-') ? ['an unmapped token sentinel'] : []),
  ];
}

describe('#200 a graph is drawn in a fixed layout, CSP-clean, with its names and labels as text', () => {
  it('#200 the same graph draws the same picture every time', () => {
    expect(specChartSvg(network)).toBe(specChartSvg(network));
    expect(specChartSvg(allocation)).toBe(specChartSvg(allocation));
  });

  it('#200 a circle graph draws every node by name and an arrowhead per edge, with no style or colour literal', () => {
    const svg = specChartSvg(network);
    expect(cspProblems(svg)).toEqual([]);
    for (const name of ['Ada Example', 'Lee-Anne Placeholder', 'Sam Sample']) {
      expect(svg).toContain(`>${name}<`);
    }
    expect(svg.match(/<path[^>]*class="fill-text-3"/g)).toHaveLength(3);
    expect(svg).toContain('<title>Commitments network</title>');
  });

  it('#200 a two-column graph labels each edge with its percent or unspecified, names its groups and carries its notes', () => {
    const svg = specChartSvg(allocation);
    expect(cspProblems(svg)).toEqual([]);
    expect(svg).toContain('>60%<');
    expect(svg).toContain('>unspecified<');
    expect(svg).toContain('>Portfolio One<');
    expect(svg).toContain('Left out: Sam Sample on a page you cannot read.');
  });
});
