import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

type GuardedRead = { readonly read: RegExp; readonly allowed: readonly string[] };

const healthRoot = 'apps/uw-app/health/';

const harnessIds: GuardedRead = {
  read: /\bharnessIdsForHealth\b/,
  allowed: ['packages/harness/reads/index.ts', healthRoot],
};

const planeTotals: GuardedRead = {
  read: /\bplaneTotals\b/,
  allowed: [
    'packages/harness/views/',
    healthRoot,
    'apps/uw-app/mcp/verbs/get-health.ts',
    'sim/scenarios/',
  ],
};

function isSource(file: string): boolean {
  return (
    ['apps/', 'packages/', 'sim/'].some((root) => file.startsWith(root)) &&
    /\.(?:tsx?|m?js)$/.test(file) &&
    !/\.test\.(?:tsx?|m?js)$/.test(file) &&
    !file.includes('node_modules')
  );
}

function strays(
  guarded: GuardedRead,
  files: readonly string[],
  read: (file: string) => string,
): string[] {
  return files
    .filter(isSource)
    .filter((file) => !guarded.allowed.some((allowed) => file.startsWith(allowed)))
    .filter((file) => guarded.read.test(read(file)));
}

const readReal = (file: string): string => readFileSync(file, 'utf8');

describe('the unchecked list of harness ids is read only by health', () => {
  it('finds it named only where it is defined and under the health routes', () => {
    expect(strays(harnessIds, repoFiles(), readReal)).toEqual([]);
  });

  it('flags a planted read outside health and allows one inside it', () => {
    const planted = new Map([
      ['apps/uw-app/commands/routes.ts', 'await kernel.reads.harnessIdsForHealth();'],
      ['apps/uw-app/health/hub.ts', 'await kernel.reads.harnessIdsForHealth();'],
      ['apps/uw-app/health/hub.test.ts', 'await kernel.reads.harnessIdsForHealth();'],
    ]);
    expect(strays(harnessIds, [...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-app/commands/routes.ts',
    ]);
  });
});

describe('the org-wide agent plane totals are read only by health and get_health', () => {
  it('finds planeTotals named only in the views, under health, in get_health and in scenarios', () => {
    expect(strays(planeTotals, repoFiles(), readReal)).toEqual([]);
  });

  it('flags a planted read in a command route and allows the health and get_health ones', () => {
    const planted = new Map([
      ['apps/uw-app/commands/routes.ts', 'await kernel.views.planeTotals({ at });'],
      ['apps/uw-app/health/agent-plane.ts', 'await kernel.views.planeTotals({ at });'],
      ['apps/uw-app/mcp/verbs/get-health.ts', 'await kernel.views.planeTotals({ at });'],
    ]);
    expect(strays(planeTotals, [...planted.keys()], (file) => planted.get(file) ?? '')).toEqual([
      'apps/uw-app/commands/routes.ts',
    ]);
  });
});
