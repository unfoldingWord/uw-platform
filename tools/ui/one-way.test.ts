import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const handRolled: readonly RegExp[] = [
  /<button\b[^>]*\bclass=/,
  /<h[1-3]\b[^>]*\bclass=/,
  /rounded-(?:md|lg) border border-line bg-surface/,
  /\bmax-w-(?:content|flow)\b/,
  /\b(?:commandButton|primaryButton|iconCommandButton)\b/,
];

function scanned(path: string): boolean {
  return /^apps\/uw-platform\/views\/screens\/[^/]+\.tsx$/.test(path);
}

function problems(path: string, text: string): string[] {
  return handRolled.filter((mark) => mark.test(text)).map((mark) => `${path}: ${mark.source}`);
}

describe('ADR 0029 one way to do each thing', () => {
  it('a screen draws no button, heading, card frame or page width of its own', () => {
    const files = repoFiles().filter(scanned);
    expect(files.length).toBeGreaterThan(30);
    const found = files.flatMap((path) => problems(path, readFileSync(path, 'utf8')));
    expect(found).toEqual([]);
  });

  it.each([
    [
      'apps/uw-platform/views/screens/board.tsx',
      '<button type="button" class="rounded-md">Go</button>',
    ],
    ['apps/uw-platform/views/screens/board.tsx', '<h2 class="text-md font-heavy">Lanes</h2>'],
    [
      'apps/uw-platform/views/screens/board.tsx',
      '<div class="rounded-md border border-line bg-surface">',
    ],
    ['apps/uw-platform/views/screens/board.tsx', '<div class="mx-auto max-w-content">'],
    ['apps/uw-platform/views/screens/board.tsx', "import { commandButton } from 'x';"],
  ])('flags a planted hand-rolled part in %s: %s', (path, text) => {
    expect(scanned(path)).toBe(true);
    expect(problems(path, text)).not.toEqual([]);
  });
});
