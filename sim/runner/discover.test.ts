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

const expectedScenarios = [
  ['AB-4.poll-returns-what-the-caller-may-claim', 'AB-4'],
  ['DX-1.kernel-over-test-adapters', 'DX-1'],
  ['DX-2.store-is-embedded-postgres', 'DX-2'],
  ['KN-10.activation-refuses-a-bypass', 'KN-10'],
  ['KN-11.ship-rule-refuses-on-facts', 'KN-11'],
  ['KN-12.high-tier-needs-two-providers-and-domain-grants', 'KN-12'],
  ['KN-13.agent-cannot-write-decision', 'KN-13'],
  ['KN-13.approve-merges-and-advances', 'KN-13'],
  ['KN-13.override-needs-a-reason', 'KN-13'],
  ['KN-13.reject-and-take-over', 'KN-13'],
  ['KN-15.both-templates-activate', 'KN-15'],
  ['KN-16.delegation-lapses-when-grant-revoked', 'KN-16'],
  ['KN-17.risk-is-floored-by-paths-and-raised-by-declaration', 'KN-17'],
  ['KN-18.activate-a-template', 'KN-18'],
  ['KN-18.lowering-ship-is-refused-by-postgres', 'KN-18'],
  ['KN-4.an-item-is-the-fold-of-its-events', 'KN-4'],
  ['KN-5.agent-cannot-claim-in-a-none-stage', 'KN-5'],
  ['KN-5.claim-takes-a-lease', 'KN-5'],
  ['KN-5.lease-expiry-releases-once', 'KN-5'],
  ['KN-5.record-run-step-renews-the-lease', 'KN-5'],
  ['KN-5.wip-limit-for-people-and-agents', 'KN-5'],
  ['KN-6.a-failing-validator-holds-the-item', 'KN-6'],
  ['KN-6.exit-gates-are-enforced-on-submit', 'KN-6'],
  ['KN-7.close-needs-a-learning-or-a-signed-nothing-learned', 'KN-7'],
  ['KN-8.feeds-edges-and-refused-transitions', 'KN-8'],
  ['KN-8.occasional-tweak-needs-a-person', 'KN-8'],
];

describe('DX-4 scenarios are files named for a requirement ID', () => {
  it('finds the scenarios, each declaring the ID its file name starts with', async () => {
    const found = await discoverScenarios(scenariosDirectory);
    expect(found.map((loaded) => [loaded.name, loaded.scenario.id])).toEqual(expectedScenarios);
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
