import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import { resolveToken, themeTokens, type ThemeName } from '../../../tools/ui/css-tokens.ts';

const themes: readonly ThemeName[] = ['light', 'dark'];

const textRoles = ['text', 'text-2', 'text-3', 'accent-text', 'human-text', 'ok-text'] as const;
const surfaces = ['canvas', 'surface', 'raised'] as const;

const textOnSurface = textRoles.flatMap((text) =>
  surfaces.map((ground) => [text, ground] as const),
);

const textOnSoft = [
  ['accent-text', 'accent-soft'],
  ['human-text', 'human-soft'],
  ['ok-text', 'ok-soft'],
  ['on-accent', 'accent'],
  ['on-accent', 'human'],
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
  it('UI-1 text-3 on canvas in light is 5.99:1', () => {
    expect(contrast('light', 'text-3', 'canvas')).toBeCloseTo(5.99, 2);
  });
});
