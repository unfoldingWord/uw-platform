import { readFileSync } from 'node:fs';
import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import { appCss } from '../generated/app-css.ts';
import {
  blockAt,
  cssBlocks,
  resolveToken,
  themeTokens,
  type CssBlock,
  type ThemeName,
} from '../../../tools/ui/css-tokens.ts';

const systemBar = '@layer base @media (forced-colors: active), (prefers-contrast: more)';
const themes: readonly ThemeName[] = ['light', 'dark'];
const pageSurfaces = ['canvas', 'surface', 'raised', 'lane', 'card'] as const;

const thumbOnGround = [
  ...pageSurfaces.map((ground) => ['text-3', ground] as const),
  ['side-text-3', 'side'] as const,
];

function baseStyles(): CssBlock[] {
  return cssBlocks(readFileSync('packages/ui/app.css', 'utf8'));
}

function contrast(theme: ThemeName, foreground: string, background: string): number {
  const tokens = themeTokens(theme);
  const ink = new Color(resolveToken(`--uw-${foreground}`, tokens));
  const ground = new Color(resolveToken(`--uw-${background}`, tokens));
  return ink.contrast(ground, 'WCAG21');
}

describe('the scrollbars take their look from the tokens', () => {
  it('the page scrollbar thumb is the text-3 role on a clear track', () => {
    expect(blockAt(baseStyles(), '@layer base :root').get('scrollbar-color')).toBe(
      'var(--uw-text-3) transparent',
    );
  });

  it('the sidebar scrollbar thumb is the side-text-3 role on a clear track', () => {
    expect(blockAt(baseStyles(), '@layer base [data-side]').get('scrollbar-color')).toBe(
      'var(--uw-side-text-3) transparent',
    );
  });

  it('every scroll area gets the thin scrollbar', () => {
    expect(blockAt(baseStyles(), '@layer base *').get('scrollbar-width')).toBe('thin');
  });

  it('the stylesheet the Worker serves carries the scrollbar rules', () => {
    expect(appCss).toContain('scrollbar-color:var(--uw-text-3) transparent');
    expect(appCss).toContain('scrollbar-color:var(--uw-side-text-3) transparent');
    expect(appCss).toContain('scrollbar-width:thin');
  });
});

describe('the scrollbars stay usable', () => {
  it('forced colours and a request for more contrast get the system scrollbar back', () => {
    const blocks = baseStyles();
    expect(blockAt(blocks, `${systemBar} :root, [data-side]`).get('scrollbar-color')).toBe('auto');
    expect(blockAt(blocks, `${systemBar} *`).get('scrollbar-width')).toBe('auto');
  });

  it.each(themes.flatMap((theme) => thumbOnGround.map((pair) => [theme, ...pair] as const)))(
    'in the %s theme the %s thumb on %s is at least 3:1',
    (theme, thumb, ground) => {
      expect(contrast(theme, thumb, ground)).toBeGreaterThanOrEqual(3);
    },
  );
});
