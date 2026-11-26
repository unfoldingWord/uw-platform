import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import { resolveToken, themeTokens, type ThemeName } from '../../../tools/ui/css-tokens.ts';

const themes: readonly ThemeName[] = ['light', 'dark'];

const textRoles = ['text', 'text-2', 'text-3', 'accent-text', 'human-text', 'ok-text'] as const;
const surfaces = ['canvas', 'surface', 'raised', 'lane', 'card', 'band'] as const;

const textOnSurface = textRoles.flatMap((text) =>
  surfaces.map((ground) => [text, ground] as const),
);

const textOnSoft = [
  ['accent-text', 'accent-soft'],
  ['human-text', 'human-soft'],
  ['ok-text', 'ok-soft'],
  ['on-accent', 'accent'],
  ['on-accent', 'human'],
  ['text-3', 'hover'],
  ['side-text', 'side'],
  ['side-text-3', 'side'],
  ['side-code', 'side'],
  ['side-text', 'side-hover'],
] as const;

function contrast(theme: ThemeName, foreground: string, background: string): number {
  const tokens = themeTokens(theme);
  const ink = new Color(resolveToken(`--uw-${foreground}`, tokens));
  const ground = new Color(resolveToken(`--uw-${background}`, tokens));
  return ink.contrast(ground, 'WCAG21');
}

describe.each(themes)('UI-1 the %s theme passes WCAG AA', (theme) => {
  it.each([...textOnSurface, ...textOnSoft])(
    'UI-1 %s on %s is at least 4.5:1',
    (foreground, background) => {
      expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('UI-1 the lowest pair is the one the design names', () => {
  it('UI-1 text-3 on lane in light is 4.54:1', () => {
    expect(contrast('light', 'text-3', 'lane')).toBeCloseTo(4.54, 2);
  });
});

const seriesRoles = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6'];
const chartGrounds = ['surface', 'card'] as const;

function lightness(theme: ThemeName, role: string): number {
  const colour = new Color(resolveToken(`--uw-${role}`, themeTokens(theme)));
  return colour.to('oklch').coords[0] ?? 0;
}

describe.each(themes)('#199 the %s chart series are a colour-blind-safe order', (theme) => {
  it.each(seriesRoles.flatMap((role) => chartGrounds.map((ground) => [role, ground] as const)))(
    '#199 %s on %s is at least 3:1, as a graphic must be',
    (role, ground) => {
      expect(contrast(theme, role, ground)).toBeGreaterThanOrEqual(3);
    },
  );

  it('#199 each series differs in lightness from the one before it, so order never rests on hue alone', () => {
    const steps = seriesRoles
      .slice(1)
      .map((role, index) =>
        Math.abs(lightness(theme, role) - lightness(theme, seriesRoles[index] ?? role)),
      );
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0.1);
  });

  it('#199 no series is Kindle, which marks a human action and nothing else', () => {
    const kindle = new Color(resolveToken('--uw-kindle-400', themeTokens(theme)));
    for (const role of seriesRoles) {
      const colour = new Color(resolveToken(`--uw-${role}`, themeTokens(theme)));
      expect(colour.deltaE(kindle, '2000')).toBeGreaterThan(10);
    }
  });
});
