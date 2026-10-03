import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const healthRead = /\bharnessIdsForHealth\b/;
const definedIn = 'packages/harness/reads/index.ts';
const healthRoot = 'apps/uw-app/health/';

function isSource(file: string): boolean {
  return (
    ['apps/', 'packages/', 'sim/'].some((root) => file.startsWith(root)) &&
    /\.(?:tsx?|m?js)$/.test(file) &&
    !/\.test\.(?:tsx?|m?js)$/.test(file) &&
    !file.includes('node_modules')
  );
}

function strays(files: readonly string[], read: (file: string) => string): string[] {
  return files
    .filter(isSource)
    .filter((file) => file !== definedIn && !file.startsWith(healthRoot))
    .filter((file) => healthRead.test(read(file)));
}

describe('the unchecked list of harness ids is read only by health', () => {
  it('finds it named only where it is defined and under the health routes', () => {
    expect(strays(repoFiles(), (file) => readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('flags a planted read outside health and allows one inside it', () => {
    const planted = new Map([
      ['apps/uw-app/commands/routes.ts', 'await kernel.reads.harnessIdsForHealth();'],
      ['apps/uw-app/health/hub.ts', 'await kernel.reads.harnessIdsForHealth();'],
      ['apps/uw-app/health/hub.test.ts', 'await kernel.reads.harnessIdsForHealth();'],
    ]);
    expect(strays([...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-app/commands/routes.ts',
    ]);
  });
});
