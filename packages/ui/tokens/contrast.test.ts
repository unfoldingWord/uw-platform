import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import { resolveToken, themeTokens, type ThemeName } from '../../../tools/ui/css-tokens.ts';

const themes: readonly ThemeName[] = ['light', 'dark'];

const textPairs = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['muted', 'surface'],
  ['muted', 'bg'],
  ['link', 'surface'],
  ['link', 'bg'],
  ['ocean', 'surface'],
  ['ocean', 'bg'],
  ['on-accent', 'inspire'],
  ['on-accent', 'cultivate'],
  ['on-accent', 'kindle'],
  ['ink', 'inspire-soft'],
  ['ink', 'cultivate-soft'],
  ['ink', 'kindle-soft'],
  ['muted', 'inspire-soft'],
  ['muted', 'cultivate-soft'],
  ['muted', 'kindle-soft'],
  ['link', 'inspire-soft'],
  ['link', 'cultivate-soft'],
  ['link', 'kindle-soft'],
  ['ocean-panel-ink', 'ocean-panel'],
] as const;

const focusPairs = [
  ['focus', 'surface'],
  ['focus', 'bg'],
  ['focus', 'ocean-panel'],
  ['focus', 'inspire-soft'],
  ['focus', 'cultivate-soft'],
  ['focus', 'kindle-soft'],
  ['kindle', 'surface'],
] as const;

function contrast(theme: ThemeName, foreground: string, background: string): number {
  const tokens = themeTokens(theme);
  const ink = new Color(resolveToken(`--uw-${foreground}`, tokens));
  const ground = new Color(resolveToken(`--uw-${background}`, tokens));
  return ink.contrast(ground, 'WCAG21');
}

describe.each(themes)('the %s theme', (theme) => {
  it.each(textPairs)('text %s on %s meets 4.5:1', (foreground, background) => {
    expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(focusPairs)(
    'the focus ring and the human-action colour: %s against %s meets 3:1',
    (foreground, background) => {
      expect(contrast(theme, foreground, background)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe('the accent fills are not text colours in light', () => {
  it.each(['inspire', 'cultivate'])(
    '%s falls below 4.5:1 on the light surface, so text sits on it in on-accent and links use link',
    (accent) => {
      expect(contrast('light', accent, 'surface')).toBeLessThan(4.5);
      expect(contrast('light', 'on-accent', accent)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
