import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverScenarios } from './discover.ts';

const scenariosDirectory = fileURLToPath(new URL('../scenarios/', import.meta.url));
const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));
const planted: string[] = [];

const validScenario =
  "export const scenario = { id: 'ZZ-3', title: 't', run: async () => ({ events: [], state: {} }) };";

function plant(files: Readonly<Record<string, string>>): string {
  mkdirSync(fixturesRoot, { recursive: true });
  const directory = mkdtempSync(join(fixturesRoot, 'uw-scenarios-'));
  planted.push(directory);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(directory, file), text);
  return directory;
}

afterAll(() => {
  for (const directory of planted) rmSync(directory, { recursive: true, force: true });
});

describe('DX-4 scenarios are files named for a requirement ID', () => {
  it('finds the scenarios, each declaring the ID its file name starts with', async () => {
    const found = await discoverScenarios(scenariosDirectory);
    expect(found.map((loaded) => [loaded.name, loaded.scenario.id])).toEqual([
      ['DX-1.kernel-over-test-adapters', 'DX-1'],
      ['DX-2.store-is-embedded-postgres', 'DX-2'],
      ['KN-10.activation-refuses-a-bypass', 'KN-10'],
      ['KN-15.both-templates-activate', 'KN-15'],
      ['KN-18.activate-a-template', 'KN-18'],
      ['KN-18.lowering-ship-is-refused-by-postgres', 'KN-18'],
      ['KN-4.an-item-is-the-fold-of-its-events', 'KN-4'],
    ]);
  });

  it('refuses a file not named for a requirement ID', async () => {
    await expect(
      discoverScenarios(plant({ 'notes.ts': 'export const other = 1;' })),
    ).rejects.toThrow(
      'sim/scenarios holds notes.ts, which is not named <requirement ID>.<slug>.ts',
    );
  });

  it('refuses a scenario whose ID differs from its file name', async () => {
    const directory = plant({ 'ZZ-9.mismatch.ts': validScenario.replace('ZZ-3', 'ZZ-1') });
    await expect(discoverScenarios(directory)).rejects.toThrow(
      'ZZ-9.mismatch.ts declares scenario ZZ-1; its file name says ZZ-9',
    );
  });

  it('refuses a file that exports no scenario', async () => {
    const directory = plant({ 'ZZ-8.empty.ts': 'export const other = 1;' });
    await expect(discoverScenarios(directory)).rejects.toThrow('ZZ-8.empty.ts exports no scenario');
  });

  it('ignores test files beside the scenarios', async () => {
    const directory = plant({
      'ZZ-3.valid.ts': validScenario,
      'notes.test.ts': 'export const other = 1;',
    });
    const found = await discoverScenarios(directory);
    expect(found.map((loaded) => loaded.name)).toEqual(['ZZ-3.valid']);
  });
});
