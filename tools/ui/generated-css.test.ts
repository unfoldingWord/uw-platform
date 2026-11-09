import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appCss, appCssPath, manifestColours } from '../../packages/ui/generated/app-css.ts';
import { resolveToken, themeTokens } from './css-tokens.ts';

const themeColours = [
  'canvas',
  'side',
  'surface',
  'raised',
  'hover',
  'line',
  'line-strong',
  'text',
  'text-2',
  'text-3',
  'accent',
  'accent-text',
  'accent-soft',
  'on-accent',
  'human',
  'human-text',
  'human-soft',
  'human-line',
  'ok',
  'ok-text',
  'ok-soft',
  'glow',
  'glow-human',
  'gridline',
];

function colourNames(css: string): string[] {
  return [...css.matchAll(/--color-([\w-]+)/g)].map((match) => match[1] ?? '');
}

describe('WB-11 the stylesheet is built from the tokens', () => {
  it('WB-11 the committed stylesheet is the Tailwind build of the tokens and components', () => {
    expect(() =>
      execFileSync('node', ['tools/ui/build-css.ts', '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
    const hash = createHash('sha256').update(appCss).digest('hex').slice(0, 12);
    expect(appCssPath).toBe(`/assets/app-${hash}.css`);
  }, 60_000);

  it('WB-11 the stylesheet has no red and no Tailwind default colour', () => {
    expect(appCss).not.toContain('--color-red');
    expect(colourNames(appCss).filter((name) => !themeColours.includes(name))).toEqual([]);
  });

  it('manifestColours are the light ocean and background tokens', () => {
    const light = themeTokens('light');
    expect(manifestColours).toEqual({
      theme: resolveToken('--uw-ocean-800', light),
      background: resolveToken('--uw-canvas', light),
      panel: resolveToken('--uw-ocean-800', light),
      panelInk: resolveToken('--uw-ocean-50', light),
    });
  });
});

describe('UI-3 the bundled fonts are the font build', () => {
  it('UI-3 the committed font module and @font-face rules are the Fontsource files', () => {
    expect(() =>
      execFileSync('node', ['tools/ui/build-fonts.ts', '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  }, 60_000);
});

describe('UI-5 the served mark is the committed brand mark', () => {
  it('UI-5 the generated mark module is the PNG in packages/ui/assets', () => {
    expect(() =>
      execFileSync('node', ['tools/ui/build-mark.ts', '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  }, 60_000);
});
