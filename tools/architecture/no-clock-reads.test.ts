import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const clockFreeRoots = ['packages/core', 'packages/harness'];

const clockRead = /\bnew\s+Date\s*\(\s*\)|\bDate\s*\.\s*now\s*\(/;

function sourcesUnder(root: string): string[] {
  return repoFiles().filter(
    (file) =>
      file.startsWith(`${root}/`) &&
      /\.tsx?$/.test(file) &&
      !/\.test\.tsx?$/.test(file) &&
      !file.includes('node_modules'),
  );
}

function clockReaders(roots: readonly string[]): string[] {
  return roots.flatMap(sourcesUnder).filter((file) => clockRead.test(readFileSync(file, 'utf8')));
}

describe('KN-11 the clock-free packages never read the clock', () => {
  it.each(['new Date()', 'new Date( )', 'Date.now()', 'Date . now ()'])('flags %j', (text) => {
    expect(clockRead.test(text)).toBe(true);
  });

  it.each(['new Date(at)', "new Date('2026-10-01T00:00:00.000Z')", 'at.getTime()'])(
    'passes %j',
    (text) => {
      expect(clockRead.test(text)).toBe(false);
    },
  );

  it('finds no new Date() or Date.now() in packages/core or packages/harness', () => {
    expect(clockReaders(clockFreeRoots)).toEqual([]);
  });
});
