import { describe, expect, it } from 'vitest';
import { hasColourLiteral } from '../../../tools/ui/colour-literals.ts';
import { dailyChartSvg, forStrictCsp, sparklineSvg } from './chart.tsx';

const days = ['Nov 1', 'Nov 2', 'Nov 3'];
const daily = { id: 'runs', label: 'Agent runs per day', days, bars: [3, 5, 2], line: [1, 2, 1] };

describe('the chart component renders ECharts as SVG on the server, for a strict CSP', () => {
  it('draws a role-named SVG with bars and a line', () => {
    const svg = dailyChartSvg(daily);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('role="img" aria-label="Agent runs per day"');
    expect(svg).toContain('class="fill-accent"');
    expect(svg).toContain('stroke-text-2');
    expect(svg).toContain('>Nov 2<');
  });

  it("carries no style element and no style attribute, so style-src 'self' holds", () => {
    for (const svg of [
      dailyChartSvg(daily),
      sparklineSvg({ id: 's', label: 'Runs', values: [1, 4, 2, 5] }),
    ]) {
      expect(svg).not.toMatch(/<style\b/);
      expect(svg).not.toMatch(/\sstyle="/);
    }
  });

  it('carries no colour literal and no sentinel: every colour is a token class', () => {
    const svg = dailyChartSvg(daily);
    expect(hasColourLiteral('chart.svg.html', svg)).toBe(false);
    expect(svg).not.toContain('token-');
  });

  it('names its clip paths from its own id, so two renders are identical', () => {
    expect(dailyChartSvg(daily)).toBe(dailyChartSvg(daily));
    expect(dailyChartSvg(daily)).toMatch(/id="runs-c\d+"/);
  });

  it('escapes the label', () => {
    expect(forStrictCsp('<svg width="1" height="1"></svg>', 'x', 'a "b" <c>')).toBe(
      '<svg class="block h-auto w-full" role="img" aria-label="a &quot;b&quot; &lt;c>"></svg>',
    );
  });
});
