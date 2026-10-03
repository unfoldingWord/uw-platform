import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appCss, appCssPath } from '../../packages/ui/generated/app-css.ts';

const themeColours = [
  'bg',
  'surface',
  'ink',
  'muted',
  'line',
  'ocean',
  'ocean-panel',
  'ocean-panel-ink',
  'inspire',
  'inspire-soft',
  'cultivate',
  'cultivate-soft',
  'kindle',
  'kindle-soft',
  'on-accent',
  'link',
  'focus',
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
});
