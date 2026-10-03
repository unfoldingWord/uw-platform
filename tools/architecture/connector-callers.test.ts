import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoFiles } from '../repo-files.ts';

const sourceRoots = ['apps/', 'packages/', 'sim/'];

const connectorRun =
  /connectors\s*\??\.\s*run\b|connectors\s*\??\.?\s*\[\s*['"`]run['"`]\s*\]|\brun\s*[,}][^=]*=\s*[\w.?]*connectors\b/;
const connectorsReference = /\bconnectors\b(?!\/)/;
const shipTypeImport = /^import type \{ ShipGitHub \} from '[./]+ports\/connectors\.ts';$/gm;
const shipRuleCall = /\bshipRule\s*\(/;
const shipRuleReference = /\bshipRule\b/;
const assemblerCall = /\bassembleShipInput\s*\(/;
const previewCall = /\bshipPreview\s*\(/;
const connectorExitCall = /\bexitThroughConnector\s*\(/;
const mergeCall = /\bwrites\s*\??\.\s*merge\s*\(|\bmergeHandler\s*\(/;
const shipWritesCall = /\bcreateShipWrites\s*\(/;
const outcomeOfCall = /connectors\s*\??\.\s*outcomeOf\b/;
const recordOutcomeCall = /\brecordExitOutcomes\s*\(/;
const shipWiring =
  /\b(?:platformConnectors|mergeHandler|createShipWrites|ShipGitHub|MergeGitHub)\b|\b(?:reads|ship)\s*:/;
const gitHubWired =
  /\bplatform(?:Kernel|Ports)\s*\(\s*(?:[^,()]*|[^,()]*\([^()]*\)[^,()]*),\s*(?:[^,()]*|[^,()]*\([^()]*\)[^,()]*),(?!\s*(?:hubWiring\(|\)))/;
const gateKernelModule = 'apps/uw-app/commands/person/gate-kernel.ts';
const kernelRoot = 'apps/uw-app/kernel.ts';
const mergeModule = 'apps/uw-app/github/merge.ts';
const connectorsAdapter = 'apps/uw-app/ports/connectors.ts';
const mergeRig = 'apps/uw-app/github/testing/merge-rig.ts';
const readOnlyRoots = ['apps/uw-app/queue/', 'apps/uw-app/cron/'];

const exitModule = 'packages/harness/gates/exit.ts';
const recoverModule = 'packages/harness/gates/recover.ts';
const lostExit = 'sim/lost-exit.ts';
const wiring = [
  'apps/uw-app/kernel.ts',
  'apps/uw-app/testing/lost-exit.ts',
  exitModule,
  recoverModule,
  'packages/harness/ports.ts',
  lostExit,
  'sim/world.ts',
];

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

function filesReferencingConnectors(files: readonly string[]): string[] {
  return files
    .filter((file) => {
      const text = readFileSync(file, 'utf8').replace(shipTypeImport, '');
      return connectorsReference.test(text);
    })
    .sort();
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
    expect(filesReferencingConnectors([passed, imported])).toEqual([passed]);
  });

  it('finds connectors.run only in the stage-exit module and the lost-exit sim helper', () => {
    expect(filesMatching(connectorRun, sources())).toEqual([exitModule, lostExit]);
  });

  it('finds the connectors port referenced only by the stage exit, the recovery, the wiring and scenarios', () => {
    const outside = filesReferencingConnectors(sources()).filter(
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

describe('the connectors adapter type import', () => {
  it('exempts only a type import of ShipGitHub from the connectors adapter', () => {
    const typeOnly = plant('ship.ts', "import type { ShipGitHub } from '../ports/connectors.ts';");
    const value = plant(
      'value.ts',
      "import { platformConnectors } from '../ports/connectors.ts';\nconst c = platformConnectors(gh);",
    );
    const mixed = plant(
      'mixed.ts',
      "import { platformConnectors, type ShipGitHub } from '../ports/connectors.ts';",
    );
    const otherType = plant(
      'other.ts',
      "import type { ShipGitHub, Other } from '../ports/connectors.ts';",
    );
    expect(filesReferencingConnectors([typeOnly, value, mixed, otherType])).toEqual(
      [value, mixed, otherType].sort(),
    );
  });
});

describe('GH-6 the merge connector runs only from the kernel stage-exit path', () => {
  it('finds the merge written and its handler built only in the merge module, the connectors adapter and the test rig', () => {
    expect(filesMatching(mergeCall, sources())).toEqual([mergeModule, mergeRig, connectorsAdapter]);
    expect(filesMatching(shipWritesCall, sources())).toEqual([
      mergeModule,
      'apps/uw-app/github/ship-writes.ts',
    ]);
  });

  it('finds the connectors port asked for an earlier outcome only by the recovery', () => {
    expect(filesMatching(outcomeOfCall, sources())).toEqual([recoverModule]);
  });

  it('finds a connector outcome recorded only by the stage exit and the recovery', () => {
    expect(filesMatching(recordOutcomeCall, sources())).toEqual([exitModule, recoverModule]);
  });

  it('GH-6 the only kernel built with GitHub reads or the ship writes is the gate kernel', () => {
    const app = sources().filter((file) => file.startsWith('apps/uw-app/'));
    expect(app.length).toBeGreaterThan(0);
    expect(filesMatching(gitHubWired, app)).toEqual([gateKernelModule, kernelRoot]);
  });

  it('GH-6 the queue and cron roots name no ship or read wiring', () => {
    const roots = readOnlyRootFiles(sources());
    expect(roots.length).toBeGreaterThan(0);
    expect(filesMatching(shipWiring, roots)).toEqual([]);
  });

  it('flags a planted merge call, outcome read and ship wiring', () => {
    const merge = plant('apps/uw-app/github/m.ts', 'await writes.merge(repo, 1, change);');
    const handler = plant('apps/uw-app/x/h.ts', 'const effects = mergeHandler(github);');
    const outcome = plant('apps/uw-app/x/o.ts', 'await ports.connectors?.outcomeOf(request);');
    const record = plant('apps/uw-app/x/r.ts', 'await recordExitOutcomes (ports, context, []);');
    const wired = plant('apps/uw-app/queue/w.ts', 'platformKernel(database, clock, ship);');
    const named = plant('apps/uw-app/cron/n.ts', 'const effects = platformConnectors(ship);');
    expect(filesMatching(mergeCall, [merge, handler])).toEqual([merge, handler].sort());
    expect(filesMatching(outcomeOfCall, [outcome])).toEqual([outcome]);
    expect(filesMatching(recordOutcomeCall, [record])).toEqual([record]);
    expect(filesMatching(gitHubWired, [wired])).toEqual([wired]);
    expect(filesMatching(shipWiring, [named])).toEqual([named]);
    expect(readOnlyRootFiles(['apps/uw-app/queue/worker.ts', 'apps/uw-app/kernel.ts'])).toEqual([
      'apps/uw-app/queue/worker.ts',
    ]);
  });
});

const wiredCalls = [
  'platformKernel(database, clock, { hub, reads, ship });',
  'platformPorts(database, clockOf(env), ship);',
  'platformKernel(handleOf(env), clock, gateWiring(github, hub, logger));',
  'platformKernel(\n  database,\n  systemClock,\n  { hub: hubOf(env), reads, ship },\n);',
];
const hubOnlyCalls = [
  'platformKernel(database, clock, hubWiring(hubNotWired));',
  'platformKernel(database, clockOf(env), hubWiring(unit.hub));',
  'platformKernel(\n  database,\n  systemClock,\n  hubWiring(unit.hub),\n);',
  'platformKernel(database, clock);',
  'platformKernel(\n  database,\n  clock,\n);',
  'platformPorts(null);',
];

describe('the GitHub kernel wiring check', () => {
  it('flags every planted kernel given GitHub, and none given the hub alone', () => {
    const wired = wiredCalls.map((text, index) =>
      plant(`apps/uw-app/queue/wired-${index}.ts`, text),
    );
    const hubOnly = hubOnlyCalls.map((text, index) =>
      plant(`apps/uw-app/cron/hub-${index}.ts`, text),
    );
    expect(filesMatching(gitHubWired, [...wired, ...hubOnly])).toEqual([...wired].sort());
  });

  it('flags a planted read or ship wiring named in a queue or cron root', () => {
    const reads = plant(
      'apps/uw-app/queue/r.ts',
      'const wiring = { hub, reads: access, ship: null };',
    );
    const ship = plant(
      'apps/uw-app/cron/s.ts',
      'const wiring = { hub, ship };\nuse({ ship : github });',
    );
    expect(filesMatching(shipWiring, [reads, ship])).toEqual([reads, ship].sort());
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

  it('finds the ship preview defined beside the approve-at-Ship path and called only from the gate view', () => {
    expect(filesMatching(previewCall, sources())).toEqual([
      approveAtShip,
      'packages/harness/gates/view.ts',
    ]);
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
