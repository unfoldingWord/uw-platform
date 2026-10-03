import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const sourceRoots = ['apps/', 'packages/', 'sim/'];

const connectorRun =
  /connectors\s*\??\.\s*run\b|connectors\s*\??\.?\s*\[\s*['"`]run['"`]\s*\]|\brun\s*[,}][^=]*=\s*[\w.?]*connectors\b/;
const connectorsReference = /\bconnectors\b(?!\/)/;
const shipRuleCall = /\bshipRule\s*\(/;
const shipRuleReference = /\bshipRule\b/;
const assemblerCall = /\bassembleShipInput\s*\(/;
const connectorExitCall = /\bexitThroughConnector\s*\(/;
const mergeCall = /\bwrites\s*\??\.\s*merge\s*\(|\bmergeHandler\s*\(/;
const shipWritesCall = /\bcreateShipWrites\s*\(/;
const outcomeOfCall = /connectors\s*\??\.\s*outcomeOf\b/;
const shipWiring =
  /\b(?:platformConnectors|mergeHandler|createShipWrites|ShipGitHub|MergeGitHub)\b/;
const threeArguments = /\bplatform(?:Kernel|Ports)\s*\(\s*[^,()]*,\s*[^,()]*,/;
const mergeModule = 'apps/uw-app/github/merge.ts';
const connectorsAdapter = 'apps/uw-app/ports/connectors.ts';
const mergeRig = 'apps/uw-app/github/testing/merge-rig.ts';
const readOnlyRoots = ['apps/uw-app/queue/', 'apps/uw-app/cron/'];

const exitModule = 'packages/harness/gates/exit.ts';
const wiring = ['apps/uw-app/kernel.ts', exitModule, 'packages/harness/ports.ts', 'sim/world.ts'];

function sourcesAmong(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      sourceRoots.some((root) => file.startsWith(root)) &&
      /\.(?:tsx?|m?js)$/.test(file) &&
      !/\.test\.(?:tsx?|m?js)$/.test(file) &&
      !file.includes('node_modules') &&
      !file.startsWith('packages/harness/port-contracts/'),
  );
}

function sources(): string[] {
  return sourcesAmong(repoFiles());
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
  mkdirSync(dirname(file), { recursive: true });
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

  it('flags a planted .mjs run call and a planted .js exit call', () => {
    const run = plant('planted.mjs', 'await ports.connectors.run(request);');
    const exit = plant('exit-caller.js', 'exitThroughConnector(ports, context, pending)');
    expect(filesMatching(connectorRun, [run])).toEqual([run]);
    expect(filesMatching(connectorExitCall, [exit])).toEqual([exit]);
  });

  it('scans .js and .mjs sources and skips their test files', () => {
    const files = ['apps/x.mjs', 'apps/y.js', 'apps/z.test.mjs', 'apps/w.test.js'];
    expect(sourcesAmong(files)).toEqual(['apps/x.mjs', 'apps/y.js']);
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
});

function readOnlyRootFiles(files: readonly string[]): string[] {
  return files.filter((file) => readOnlyRoots.some((root) => file.startsWith(root)));
}

describe('GH-6 the merge connector runs only from the kernel stage-exit path', () => {
  it('finds the merge written and its handler built only in the merge module, the connectors adapter and the test rig', () => {
    expect(filesMatching(mergeCall, sources())).toEqual([mergeModule, mergeRig, connectorsAdapter]);
    expect(filesMatching(shipWritesCall, sources())).toEqual([
      mergeModule,
      'apps/uw-app/github/ship-writes.ts',
    ]);
  });

  it('finds no source asking the connectors port for an earlier outcome', () => {
    expect(filesMatching(outcomeOfCall, sources())).toEqual([]);
  });

  it('gives the queue and cron roots a kernel with no ship GitHub', () => {
    const roots = readOnlyRootFiles(sources());
    expect(roots.length).toBeGreaterThan(0);
    expect(filesMatching(shipWiring, roots)).toEqual([]);
    expect(filesMatching(threeArguments, roots)).toEqual([]);
  });

  it('flags a planted merge call, outcome read and ship wiring', () => {
    const merge = plant('apps/uw-app/github/m.ts', 'await writes.merge(repo, 1, change);');
    const handler = plant('apps/uw-app/x/h.ts', 'const effects = mergeHandler(github);');
    const outcome = plant('apps/uw-app/x/o.ts', 'await ports.connectors?.outcomeOf(request);');
    const wired = plant('apps/uw-app/queue/w.ts', 'platformKernel(database, clock, ship);');
    const named = plant('apps/uw-app/cron/n.ts', 'const effects = platformConnectors(ship);');
    expect(filesMatching(mergeCall, [merge, handler])).toEqual([merge, handler].sort());
    expect(filesMatching(outcomeOfCall, [outcome])).toEqual([outcome]);
    expect(filesMatching(threeArguments, [wired])).toEqual([wired]);
    expect(filesMatching(shipWiring, [named])).toEqual([named]);
    expect(readOnlyRootFiles(['apps/uw-app/queue/worker.ts', 'apps/uw-app/kernel.ts'])).toEqual([
      'apps/uw-app/queue/worker.ts',
    ]);
  });
});

const approveAtShip = 'packages/harness/gates/approve-at-ship.ts';
const shipRuleModule = 'packages/harness/ship-rule.ts';
const shipRuleCallers = [approveAtShip, shipRuleModule];
const shipRuleNames = [approveAtShip, 'packages/harness/index.ts', shipRuleModule];
const assemblerCallers = [approveAtShip, 'packages/harness/gates/ship-input.ts'];

function strays(pattern: RegExp, allowed: readonly string[], files: readonly string[]): string[] {
  return filesMatching(pattern, files).filter((file) => !allowed.includes(file));
}

describe("GH-5 the assembler is the ship rule's only caller", () => {
  it('finds the assembler called only from the approve-at-Ship path and its own module', () => {
    expect(filesMatching(assemblerCall, sources())).toEqual(assemblerCallers);
  });

  it('finds the ship rule called only from the approve-at-Ship path and its own module', () => {
    expect(filesMatching(shipRuleCall, sources())).toEqual(shipRuleCallers);
  });

  it('finds the ship rule named only where it is called, defined and published', () => {
    expect(filesMatching(shipRuleReference, sources())).toEqual(shipRuleNames);
  });

  it('flags a planted call of the ship rule or the assembler from an app module', () => {
    const viaKernel = plant('apps/uw-app/x.ts', 'kernel.shipRule(input);');
    const direct = plant('apps/uw-app/y.ts', 'shipRule(input);');
    const aliased = plant('apps/uw-app/z.ts', "import { shipRule as rule } from '@uw/harness';");
    const assembler = plant('apps/uw-app/w.ts', 'assembleShipInput(source);');
    expect(sourcesAmong(['apps/uw-app/x.ts', 'apps/uw-app/x.test.ts'])).toEqual([
      'apps/uw-app/x.ts',
    ]);
    expect(strays(shipRuleCall, shipRuleCallers, [viaKernel, direct])).toEqual(
      [viaKernel, direct].sort(),
    );
    expect(strays(shipRuleReference, shipRuleNames, [aliased])).toEqual([aliased]);
    expect(strays(assemblerCall, assemblerCallers, [assembler])).toEqual([assembler]);
  });
});
