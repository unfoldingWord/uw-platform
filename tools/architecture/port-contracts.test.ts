import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { portNames } from '../../packages/harness/ports.ts';
import { repoFiles } from '../repo-files.ts';
import { portContractViolations, type SourceTree } from './port-contracts.ts';

function repoTree(): SourceTree {
  return { paths: repoFiles(), read: (path) => readFileSync(path, 'utf8') };
}

function tree(files: Record<string, string>): SourceTree {
  return { paths: Object.keys(files), read: (path) => files[path] ?? '' };
}

function without(files: Record<string, string>, removed: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== removed));
}

const suite = { 'packages/harness/port-contracts/hub.ts': 'export function describeHubContract(' };
const runner = "import { describeHubContract } from '@uw/harness/port-contracts/hub';";

const wired = {
  ...suite,
  'apps/uw-app/ports/hub.not-wired.ts': '',
  'apps/uw-app/ports/hub.contract.test.ts': `${runner} import { hubNotWired } from './hub.not-wired.ts';`,
  'sim/adapters/hub.ts': '',
  'sim/adapters/hub.contract.test.ts': `${runner} import { createSimHub } from './hub.ts';`,
};

describe('DX-3 every port has a contract run against every adapter', () => {
  it('holds for the repository', () => {
    expect(portContractViolations(portNames, repoTree())).toEqual([]);
  });

  it('accepts a port with a suite and a contract test beside each adapter', () => {
    expect(portContractViolations(['hub'], tree(wired))).toEqual([]);
  });

  it('allows other tests beside the adapters', () => {
    const files = { ...wired, 'sim/adapters/recording-adapters.test.ts': '' };
    expect(portContractViolations(['hub'], tree(files))).toEqual([]);
  });

  it('fails on a port with no contract suite', () => {
    expect(portContractViolations(['hub', 'clock'], tree(wired))).toContain(
      'clock: no contract suite at packages/harness/port-contracts/clock.ts',
    );
  });

  it('fails on a suite that does not export its describe function', () => {
    const files = { ...wired, 'packages/harness/port-contracts/hub.ts': '' };
    expect(portContractViolations(['hub'], tree(files))).toContain(
      'hub: packages/harness/port-contracts/hub.ts does not export describeHubContract',
    );
  });

  it('fails on an adapter no contract test runs', () => {
    const files = { ...wired, 'sim/adapters/hub.recording.ts': '' };
    expect(portContractViolations(['hub'], tree(files))).toContain(
      'sim/adapters/hub.recording.ts: no contract test in sim/adapters/ runs it against the hub contract',
    );
  });

  it('fails on a port with no test adapter', () => {
    expect(portContractViolations(['hub'], tree(without(wired, 'sim/adapters/hub.ts')))).toContain(
      'hub: no adapter in sim/adapters/',
    );
  });
});

describe('DX-3 the check refuses a misplaced file', () => {
  it('fails on an adapter root file not named for a port', () => {
    const files = { ...wired, 'apps/uw-app/ports/helpers.ts': '' };
    expect(portContractViolations(['hub'], tree(files))).toContain(
      'apps/uw-app/ports/helpers.ts: an adapter file must be named for its port',
    );
  });

  it('fails when the contract test imports the adapter but not the suite', () => {
    const files = {
      ...wired,
      'sim/adapters/hub.contract.test.ts': "import { createSimHub } from './hub.ts';",
    };
    expect(portContractViolations(['hub'], tree(files))).toContain(
      'sim/adapters/hub.ts: no contract test in sim/adapters/ runs it against the hub contract',
    );
  });
});
