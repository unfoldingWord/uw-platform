import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const sourceRoots = ['apps/', 'packages/', 'sim/'];

const connectorRun = /connectors\s*\.\s*run\b|\brun\s*\}\s*=\s*[\w.]*connectors\b/;
const shipRuleCall = /\bshipRule\s*\(/;
const connectorExitCall = /\bexitThroughConnector\s*\(/;

function sources(): string[] {
  return repoFiles().filter(
    (file) =>
      sourceRoots.some((root) => file.startsWith(root)) &&
      /\.tsx?$/.test(file) &&
      !/\.test\.tsx?$/.test(file) &&
      !file.includes('node_modules') &&
      !file.startsWith('packages/harness/port-contracts/'),
  );
}

function filesMatching(pattern: RegExp): string[] {
  return sources()
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .sort();
}

describe('the connectors port runs only from the kernel stage-exit path', () => {
  it.each([
    'ports.connectors.run(request)',
    'ports.connectors . run',
    'const { run } = connectors',
  ])('flags %j', (text) => {
    expect(connectorRun.test(text)).toBe(true);
  });

  it('finds connectors.run only in the stage-exit module', () => {
    expect(filesMatching(connectorRun)).toEqual(['packages/harness/gates/exit.ts']);
  });

  it('finds the stage exit called only from the approve-at-Ship path', () => {
    expect(filesMatching(connectorExitCall)).toEqual([
      'packages/harness/gates/approve-at-ship.ts',
      'packages/harness/gates/exit.ts',
    ]);
  });

  it('finds the ship rule called only from the approve-at-Ship path and its own module', () => {
    expect(filesMatching(shipRuleCall)).toEqual([
      'packages/harness/gates/approve-at-ship.ts',
      'packages/harness/ship-rule.ts',
    ]);
  });
});
