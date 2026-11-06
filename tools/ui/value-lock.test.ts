import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';
import { arbitraryClasses, rawCssValues, rawStyleValues } from './value-lock.ts';

const tokenHome = /^packages\/ui\/tokens\/[^/]+\.css$/;

function shipped(path: string): boolean {
  return (
    /^(apps|packages\/ui)\//.test(path) &&
    !/\.test\.tsx?$/.test(path) &&
    !/\/(generated|dist|testing)\//.test(path) &&
    !tokenHome.test(path)
  );
}

const sources = (): string[] =>
  repoFiles()
    .filter(shipped)
    .filter((path) => /\.tsx?$/.test(path));
const stylesheets = (): string[] =>
  repoFiles()
    .filter(shipped)
    .filter((path) => path.endsWith('.css'));

const offenders = (paths: string[], find: (path: string, text: string) => string[]): string[] =>
  paths.flatMap((path) => find(path, readFileSync(path, 'utf8')).map((hit) => `${path}: ${hit}`));

describe('UI-2 the build fails on a value outside the tokens', () => {
  it('UI-2 no class carries an arbitrary value', () => {
    expect(sources().length).toBeGreaterThan(50);
    expect(offenders(sources(), arbitraryClasses)).toEqual([]);
  });

  it('UI-2 no stylesheet outside the token files writes a raw size or shadow', () => {
    expect(stylesheets()).toContain('packages/ui/app.css');
    expect(offenders(stylesheets(), (_path, text) => rawCssValues(text))).toEqual([]);
  });

  it('UI-2 no style string writes a raw size or shadow', () => {
    expect(offenders(sources(), rawStyleValues)).toEqual([]);
  });
});

describe('UI-2 the lock catches planted values', () => {
  it.each([
    ['apps/uw-app/views/screens/board.tsx', '<p class="p-[18px] text-text">x</p>', 'p-[18px]'],
    ['apps/uw-app/views/screens/board.tsx', '<p class="md:text-[13px]">x</p>', 'md:text-[13px]'],
    ['packages/ui/components/card.tsx', "const c = 'rounded-[14px] flex';", 'rounded-[14px]'],
    ['packages/ui/components/card.tsx', 'const c = `gap-2 -mt-[3px]`;', '-mt-[3px]'],
    ['packages/ui/components/card.tsx', "const c = 'bg-[#fff]';", 'bg-[#fff]'],
    [
      'packages/ui/components/card.tsx',
      "const c = 'w-[var(--uw-layout-side)]';",
      'w-[var(--uw-layout-side)]',
    ],
    [
      'packages/ui/components/card.tsx',
      "const c = '[mask-type:luminance]';",
      '[mask-type:luminance]',
    ],
  ])('UI-2 flags a planted arbitrary value in %s: %s', (path, text, hit) => {
    expect(shipped(path)).toBe(true);
    expect(arbitraryClasses(path, text)).toEqual([hit]);
  });

  it.each([
    ['apps/uw-app/views/screens/board.tsx', '<a class="aria-[current=page]:font-heavy p-4">x</a>'],
    ['apps/uw-app/views/screens/board.tsx', "const route = '/harness/[key]/board';"],
    ['apps/uw-app/views/screens/board.tsx', "const pick = 'input[type=checkbox]';"],
  ])('UI-2 passes an arbitrary variant or a non-class string in %s: %s', (path, text) => {
    expect(arbitraryClasses(path, text)).toEqual([]);
  });
});

describe('UI-2 the lock catches planted raw sizes and shadows', () => {
  it.each([
    'a { padding: 18px; }',
    '.x { margin-top: 0.5rem }',
    '.x { box-shadow: 0 1px 2px black; }',
    '@utility gap-odd { gap: 6px; }',
  ])('UI-2 flags a planted raw value in a stylesheet: %s', (css) => {
    expect(rawCssValues(css)).toHaveLength(1);
  });

  it('UI-2 passes a token reference and the literal breakpoints', () => {
    expect(
      rawCssValues('a { padding: var(--uw-space-4); box-shadow: var(--uw-shadow-1); }'),
    ).toEqual([]);
    expect(rawCssValues('@theme { --breakpoint-md: 48rem; }')).toEqual([]);
  });

  it.each([
    ['apps/uw-app/views/screens/board.tsx', '<p style="padding: 18px">x</p>'],
    ['apps/uw-app/views/screens/board.tsx', "const s = 'font-size:13px';"],
    ['packages/ui/components/card.tsx', "const s = 'box-shadow: 0 0 4px';"],
  ])('UI-2 flags a planted raw style value in %s: %s', (path, text) => {
    expect(rawStyleValues(path, text)).toHaveLength(1);
  });

  it('UI-2 passes a style string that uses a token', () => {
    expect(rawStyleValues('apps/uw-app/x.tsx', "const s = 'gap: var(--uw-space-2)';")).toEqual([]);
  });
});
