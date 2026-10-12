import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { discoverScenarios } from '../runner/discover.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const scenariosDirectory = fileURLToPath(new URL('../scenarios/', import.meta.url));
const commandTimeout = 90_000;
const everyScenarioTimeout = 300_000;

function run(script: string, args: readonly string[], timeout: number): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout,
  });
}

function exited(
  status: number,
  script: string,
  args: readonly string[],
  timeout = 60_000,
): SpawnSyncReturns<string> {
  const result = run(script, args, timeout);
  if (result.status === null)
    throw new Error(`${script} did not exit on its own: ${result.stderr}`);
  expect(result.status, `${result.stderr}${result.stdout}`).toBe(status);
  return result;
}

function expectDx1Passes(args: readonly string[]): void {
  const { stdout } = exited(0, 'sim/cli/sim.ts', args);
  for (const line of [
    'scenario DX-1.kernel-over-test-adapters:',
    'events (0):',
    'state:',
    'result: pass',
    '1 of 1 scenarios passed',
  ]) {
    expect(stdout).toContain(line);
  }
}

describe('DX-4 the sim command', () => {
  it(
    'runs one scenario by requirement ID and prints its log, state and result',
    () => {
      expectDx1Passes(['DX-1']);
    },
    commandTimeout,
  );

  it(
    'drops a literal -- before reading the selector',
    () => {
      expectDx1Passes(['--', 'DX-1']);
    },
    commandTimeout,
  );

  it(
    'runs every scenario with all',
    () => {
      expect(exited(0, 'sim/cli/sim.ts', ['all'], everyScenarioTimeout - 10_000).stdout).toMatch(
        /(\d+) of \1 scenarios passed/,
      );
    },
    everyScenarioTimeout,
  );

  it(
    'names the known scenarios when none matches',
    async () => {
      const { stderr } = exited(1, 'sim/cli/sim.ts', ['ZZ-1']);
      const prefix = 'no scenario matches ZZ-1; known: ';
      expect(stderr).toMatch(/^no scenario matches ZZ-1; known: /);
      const known = (await discoverScenarios(scenariosDirectory)).map((loaded) => loaded.name);
      expect(known.length).toBeGreaterThan(0);
      expect(stderr.slice(prefix.length).trimEnd()).toBe(known.join(', '));
    },
    commandTimeout,
  );

  it(
    'prints the sim usage with no selector',
    () => {
      expect(exited(1, 'sim/cli/sim.ts', []).stderr).toContain(
        'usage: pnpm sim -- <scenario | requirement ID | all>',
      );
    },
    commandTimeout,
  );
});

describe('DX-5 the walk command', () => {
  it(
    'prints both templates for walk all',
    () => {
      const { stdout } = exited(0, 'sim/cli/walk.ts', ['all']);
      expect(stdout).toContain('template software (Software delivery):');
      expect(stdout).toContain('ship [human_approval, merge]');
      expect(stdout).toContain('template bml (BML product flywheel):');
      expect(stdout).toContain('ship [human_approval, publish]');
    },
    commandTimeout,
  );

  it(
    'names the registered templates when the asked one is unknown',
    () => {
      expect(exited(1, 'sim/cli/walk.ts', ['nonesuch']).stderr).toContain(
        'unknown template nonesuch; registered: software, bml',
      );
    },
    commandTimeout,
  );

  it(
    'prints the walk usage with no template',
    () => {
      expect(exited(1, 'sim/cli/walk.ts', []).stderr).toContain(
        'usage: pnpm walk -- <template | all>',
      );
    },
    commandTimeout,
  );
});
