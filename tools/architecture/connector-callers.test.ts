import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const sourceRoots = ['apps/', 'packages/', 'sim/'];

const connectorRun =
  /connectors\s*\??\.\s*run\b|connectors\s*\??\.?\s*\[\s*['"`]run['"`]\s*\]|\brun\s*[,}][^=]*=\s*[\w.?]*connectors\b/;
const connectorsReference = /\bconnectors\b(?!\/)/;
const shipRuleCall = /\bshipRule\s*\(/;
const connectorExitCall = /\bexitThroughConnector\s*\(/;

const exitModule = 'packages/harness/gates/exit.ts';
const wiring = [
  'apps/uw-app/kernel.ts',
  'apps/uw-app/ports/connectors.not-wired.ts',
  exitModule,
  'packages/harness/ports.ts',
  'sim/world.ts',
];

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

function filesMatching(pattern: RegExp, files: readonly string[]): string[] {
  return files.filter((file) => pattern.test(readFileSync(file, 'utf8'))).sort();
}

const planted = mkdtempSync(join(tmpdir(), 'connector-callers-'));

afterAll(() => {
  rmSync(planted, { recursive: true, force: true });
});

function plant(name: string, text: string): string {
  const file = join(planted, name);
  writeFileSync(file, text);
  return file;
}

const runCalls = [
  'await ports.connectors.run(request);',
  'await ports.connectors?.run(request);',
  "await ports.connectors['run'](request);",
  'await ports.connectors?.["run"](request);',
  'await ports.connectors . run (request);',
  'const { run } = ports.connectors;',
  'const { hub, run } = ports?.connectors;',
];

describe('the connectors port runs only from the kernel stage-exit path', () => {
  it('flags every planted way of calling run on the connectors port', () => {
    const files = runCalls.map((text, index) => plant(`run-${index}.ts`, text));
    expect(filesMatching(connectorRun, files)).toEqual([...files].sort());
  });

  it('flags a planted file that only references the connectors port', () => {
    const passed = plant('pass-along.ts', 'const effects = ports.connectors;');
    const imported = plant('registry.ts', "import { x } from '../connectors/registry.ts';");
    expect(filesMatching(connectorsReference, [passed, imported])).toEqual([passed]);
  });

  it('finds connectors.run only in the stage-exit module', () => {
    expect(filesMatching(connectorRun, sources())).toEqual([exitModule]);
  });

  it('finds the connectors port referenced only by the stage exit, the wiring and scenarios', () => {
    const outside = filesMatching(connectorsReference, sources()).filter(
      (file) => !file.startsWith('sim/scenarios/'),
    );
    expect(outside).toEqual([...wiring].sort());
  });

  it('finds the stage exit called only from the approve-at-Ship path', () => {
    expect(filesMatching(connectorExitCall, sources())).toEqual([
      'packages/harness/gates/approve-at-ship.ts',
      exitModule,
    ]);
  });

  it('finds the ship rule called only from the approve-at-Ship path and its own module', () => {
    expect(filesMatching(shipRuleCall, sources())).toEqual([
      'packages/harness/gates/approve-at-ship.ts',
      'packages/harness/ship-rule.ts',
    ]);
  });
});
