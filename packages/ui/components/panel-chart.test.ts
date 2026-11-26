import { describe, expect, it } from 'vitest';
import { hasColourLiteral } from '../../../tools/ui/colour-literals.ts';
import { barsChartSvg, trendLineSvg } from './panel-chart.tsx';

const bars = {
  id: 'score-bars',
  label: 'Score by site',
  names: ['door43.org', 'unfoldingword.org'],
  values: [64, 81],
  target: 80,
  targetLabel: 'Target 80',
};

const trend = { id: 'trend-1', label: 'Score over time, Door43', values: [60, 62, null, 40, 45] };

describe('ADR 0036 panels draw bars with a target and a trend with breaks as token-only SVG', () => {
  it('draws one horizontal bar per resource and the target as a dashed line', () => {
    const svg = barsChartSvg(bars);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('role="img" aria-label="Score by site"');
    expect(svg).toContain('fill-accent');
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('>unfoldingword.org<');
    expect(svg).toContain('>Target 80<');
  });

  it('draws bars without a target when none is set', () => {
    const svg = barsChartSvg({ ...bars, target: null, targetLabel: '' });
    expect(svg).not.toContain('stroke-dasharray');
  });

  it('grows taller with more resources, so names stay readable at phone width', () => {
    const many = {
      ...bars,
      names: Array.from({ length: 20 }, (_, n) => `site ${n}`),
      values: Array.from({ length: 20 }, () => 50),
    };
    const height = (svg: string) => Number(/viewBox="0 0 \d+ (\d+)"/.exec(svg)?.[1]);
    expect(height(barsChartSvg(many))).toBeGreaterThan(height(barsChartSvg(bars)));
  });

  it('breaks the trend line where a value is missing, never joining it through zero', () => {
    const svg = trendLineSvg(trend);
    expect(svg).toContain('role="img" aria-label="Score over time, Door43"');
    const line = /<path d="([^"]*)" fill="none"[^>]*stroke-accent/.exec(svg)?.[1] ?? '';
    expect(line.match(/M/g)).toHaveLength(2);
    expect(svg).not.toContain('fill="#');
  });

  it('carries no style, no colour literal and no sentinel, and renders the same twice', () => {
    for (const svg of [barsChartSvg(bars), trendLineSvg(trend)]) {
      expect(svg).not.toMatch(/<style\b|\sstyle="|token-/);
      expect(hasColourLiteral('panel.svg.html', svg)).toBe(false);
    }
    expect(barsChartSvg(bars)).toBe(barsChartSvg(bars));
  });

  it('escapes a hostile resource name', () => {
    const svg = barsChartSvg({ ...bars, names: ['<img src=x onerror=alert(1)>', 'b'] });
    expect(svg).not.toContain('<img');
  });
});
