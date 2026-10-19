import { existsSync, readFileSync } from 'node:fs';
import {
  bypassesShip,
  delegationProperty,
  templateProperty,
  templates,
} from '../../packages/harness/index.ts';
import { describe, expect, it } from 'vitest';
import { repositoryTrace } from '../trace/repository.ts';
import { traceExitCode } from '../trace/trace.ts';

const callArguments = /\.(?:each|skipIf|runIf)\([^()]*\)/g;
const titlePattern = /\b(?:describe|it|test)[.\w]*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
const weakeners = /\b(?:describe|it|test|suite)[.\w]*\.(?:skip|todo|fails|only)\b|\.skip\(/;
const conditions = /\.(skipIf|runIf)\(([^)]*)\)/g;
const allowedConditions = new Set([
  'skipIf !testServer',
  'runIf testServer',
  "skipIf process.env['CI'] !== 'true'",
]);

const staticCheck = 'tools/architecture/agent-boundary.test.ts';
const runtimeCheck = 'sim/kernel/agent-boundary-runtime.test.ts';
const conformanceCheck = 'apps/uw-app/mcp/conformance.pg.test.ts';
const plantedConformance = 'apps/uw-app/testing/conformance.test.ts';
const grantRace = 'apps/uw-app/harness/grant-race.pg.test.ts';
const claimsRace = 'apps/uw-app/harness/claims.pg.test.ts';
const storeRace = 'packages/db/store/claim-race.test.ts';
const ciDatabase = 'tools/ci/test-database.test.ts';
const templatePropertyTest = 'packages/harness/template-property.test.ts';
const joiningJourney =
  'sim/scenarios/DX-10.the-joining-journey-from-shadow-to-a-delegated-merge.ts';
const gateWriters = 'tools/architecture/gate-writers.test.ts';
const untrustedCheck = 'tools/architecture/untrusted-content.test.ts';

function readSource(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function source(path: string): string {
  const text = readSource(path);
  expect(text, `${path} is missing`).not.toBeNull();
  return text ?? '';
}

function titlesIn(text: string): string[] {
  const plain = text.replaceAll(callArguments, '');
  return [...plain.matchAll(titlePattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? '');
}

function hasTitle(text: string, prefix: string): boolean {
  return titlesIn(text).some((title) => title.startsWith(prefix));
}

function isWeakened(text: string): boolean {
  const conditional = [...text.matchAll(conditions)].some(
    ([, kind, condition]) => !allowedConditions.has(`${kind ?? ''} ${(condition ?? '').trim()}`),
  );
  return conditional || weakeners.test(text);
}

function jobBlock(workflow: string, job: string): string {
  const start = workflow.indexOf(`\n  ${job}:`);
  if (start === -1) return '';
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function expectTitle(path: string, prefix: string): void {
  expect(hasTitle(source(path), prefix), `${path}: "${prefix}"`).toBe(true);
}

function expectNotWeakened(path: string): void {
  expect(isWeakened(source(path)), `${path} skips or narrows a case`).toBe(false);
}

describe('the release guard catches a weakened proof', () => {
  it('flags a skipped, todo, failing-by-design or focused case in any chained form', () => {
    expect(isWeakened("it.skip('a planted case', () => {})")).toBe(true);
    expect(isWeakened("describe.sequential.skip('a planted suite', () => {})")).toBe(true);
    expect(isWeakened("it.concurrent.only('a planted case', () => {})")).toBe(true);
    expect(isWeakened("describe.skipIf(true)('a planted suite', () => {})")).toBe(true);
    expect(isWeakened("test.todo('a planted case')")).toBe(true);
    expect(isWeakened("suite.skip('a planted suite', () => {})")).toBe(true);
    expect(isWeakened("it('a planted case', (ctx) => { ctx.skip(); })")).toBe(true);
  });

  it('flags a suite run or skipped on any condition but the test server', () => {
    expect(isWeakened("describe.runIf(false)('a planted suite', () => {})")).toBe(true);
    expect(isWeakened("describe.skipIf(process.env.CI)('a planted suite', () => {})")).toBe(true);
    expect(isWeakened("describe.skipIf(isCi())('a planted suite', () => {})")).toBe(true);
    expect(isWeakened("describe.skipIf(1)('a planted suite', () => {})")).toBe(true);
    expect(isWeakened("describe.runIf(testServer)('a planted suite', () => {})")).toBe(false);
  });

  it('reads a CI job only up to the next job', () => {
    const workflow =
      'jobs:\n  test:\n    runs-on: x\n  later:\n    services:\n      image: postgres:16\n';
    expect(jobBlock(workflow, 'test')).not.toContain('postgres:16');
    expect(jobBlock(workflow, 'later')).toContain('postgres:16');
    expect(jobBlock(workflow, 'missing')).toBe('');
  });

  it('leaves a suite gated on the test server alone and reads its title across lines', () => {
    const gated = "describe.skipIf(!testServer)(\n  'a planted race suite',\n  () => {},\n);";
    expect(isWeakened(gated)).toBe(false);
    expect(hasTitle(gated, 'a planted race suite')).toBe(true);
    expect(hasTitle(gated, 'another suite')).toBe(false);
  });

  it('finds no source for a missing file', () => {
    expect(readSource('tools/release/a-planted-missing-file.test.ts')).toBeNull();
  });
});

describe('release criterion 1: pnpm verify runs walk, trace and the whole sim', () => {
  it('chains walk:all, trace:built, the tests and sim:all in that order', () => {
    const manifest: unknown = JSON.parse(source('package.json'));
    const scripts = new Map(
      Object.entries((manifest as { readonly scripts: Readonly<Record<string, string>> }).scripts),
    );
    const chain = (scripts.get('verify') ?? '').split(' && ');
    const wanted = ['pnpm walk:all', 'pnpm trace:built', 'pnpm test', 'pnpm sim:all'];
    const positions = wanted.map((step) => chain.indexOf(step));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(scripts.get('walk:all')).toBe('node sim/cli/walk.ts all');
    expect(scripts.get('sim:all')).toBe('node sim/cli/sim.ts all');
  });
});

describe('release criterion 2: every Must requirement in a built step has a scenario or a test named for it', () => {
  it('leaves no due Must requirement unproven, so pnpm trace:built exits 0', () => {
    const report = repositoryTrace();
    expect(report.unproven.filter((entry) => entry.due).map((entry) => entry.id)).toEqual([]);
    expect(traceExitCode(report, 'built')).toBe(0);
  });
});

describe('release criterion 3, by structure: the DX-7 scenario and its coverage module exist (pnpm sim:all in item 1 runs it)', () => {
  it('keeps the scenario file named for DX-7 and the whole-journey checks', () => {
    const scenario = source('sim/scenarios/DX-7.software-template-end-to-end.ts');
    expect(scenario).toContain("id: 'DX-7'");
    expect(scenario).toContain('await everyGateCrossed(journey)');
    expect(source('sim/e2e/coverage.ts')).toContain('export async function everyGateCrossed(');
  });
});

describe('release criterion 3 for v0.2.0, by structure: the DX-10 scenario drives the joining journey (pnpm sim:all in item 1 runs it)', () => {
  it('keeps the scenario file named for DX-10 and its six beats', () => {
    const scenario = source(joiningJourney);
    expect(scenario).toContain("id: 'DX-10'");
    const beats = [
      'shadowRound(',
      'liftAndPost(',
      'waitsForAPerson(',
      'mergedUnderDelegation(',
      'refusedForProtectedPath(',
    ];
    for (const beat of beats) expect(scenario).toContain(`await ${beat}`);
    expect(scenario).toContain('await joinedWorld(world, {');
  });
});

describe('release criterion 4: the three templates pass the property, the negative fixture fails it, and no exit a delegation can take reaches deploy or publish', () => {
  it('passes software, bml and check-only, fails the fixture that bypasses Ship, and keeps both KN-10 cases', () => {
    expect([...templates.keys()].sort()).toEqual(['bml', 'check-only', 'software']);
    for (const template of templates.values()) {
      expect(templateProperty(template.stages)).toEqual([]);
    }
    expect(templateProperty(bypassesShip.stages).length).toBeGreaterThan(0);
    expectTitle(templatePropertyTest, 'KN-10 every registered template');
    expectTitle(templatePropertyTest, 'KN-10 the negative fixture');
    expectNotWeakened(templatePropertyTest);
  });

  it('passes the MD-4 delegation property on every template, fails a delegation that could take any human exit, and keeps both MD-4 cases', () => {
    for (const template of templates.values()) {
      expect(delegationProperty(template.stages)).toEqual([]);
    }
    const permissive = (stage: { readonly exitGate: string }) =>
      stage.exitGate === 'human_approval';
    const bml = templates.get('bml')?.stages ?? [];
    expect(delegationProperty(bml, permissive).length).toBeGreaterThan(0);
    expectTitle(templatePropertyTest, 'MD-4 no path reaches a deploy or publish connector');
    expectTitle(templatePropertyTest, 'MD-4 every registered template passes');
    expectTitle(templatePropertyTest, 'MD-4 a delegation that could take any human exit fails');
  });
});

describe('release criterion 5, by structure: the three AB-7 checks and their planted halves exist and are not skipped', () => {
  it('keeps the static check over the real tree and its three planted cases', () => {
    expectTitle(staticCheck, 'AB-7 no file an agent principal can reach');
    expectTitle(staticCheck, 'AB-7 the static check fails on a planted handler');
    expectTitle(staticCheck, 'AB-7 a planted gate touch outside the person surface fails');
    expectTitle(staticCheck, 'AB-7 the static check fails on a planted route');
  });

  it('keeps the runtime scenario and its planted gate command', () => {
    expect(existsSync('sim/scenarios/AB-7.no-agent-identity-writes-a-gate-decision.ts')).toBe(true);
    expectTitle(runtimeCheck, 'AB-7 the runtime check fails on a planted gate command');
  });

  it('keeps the conformance check and its two planted cases', () => {
    expectTitle(
      conformanceCheck,
      'AB-7 the Workflow host and an external runner see the same verbs',
    );
    expectTitle(
      plantedConformance,
      'AB-7 the conformance check fails on a planted host-specific tool',
    );
    expectTitle(
      plantedConformance,
      'AB-7 the conformance check fails on a verb a host cannot answer',
    );
  });

  it('skips none of the four files', () => {
    for (const path of [staticCheck, runtimeCheck, conformanceCheck, plantedConformance]) {
      expectNotWeakened(path);
    }
  });

  it('keeps the MD-5 gate-writer check over the tree and its planted second writer, unskipped', () => {
    expectTitle(gateWriters, 'MD-5 exactly two named functions write a gate decision');
    expectTitle(gateWriters, 'MD-5 a planted second delegated writer fails');
    expectTitle(gateWriters, 'MD-5 a planted write in any form fails');
    expectNotWeakened(gateWriters);
  });

  it('keeps the UC-4 untrusted content check over the tree and its planted cases, unskipped', () => {
    expectTitle(untrustedCheck, 'UC-4 the tree passes the untrusted content check');
    expectTitle(
      untrustedCheck,
      'UC-4 the check fails on a planted call with an unwrapped outside read',
    );
    expectTitle(untrustedCheck, 'UC-4 the check fails on a planted builder');
    expectTitle(untrustedCheck, 'UC-4 the check fails on a planted forgery of the wrapper');
    expectNotWeakened(untrustedCheck);
  });
});

describe('release criterion 6, the part a local run can check: the race suites exist, are not skipped, and the CI test job gives them a postgres:16 service container', () => {
  it('keeps the race and CI database titles, unskipped', () => {
    expectTitle(grantRace, 'KN-14 DX-6 the grant re-read race');
    expectTitle(claimsRace, 'DX-6 claims race on separate connections');
    expectTitle(storeRace, 'KN-5 write.claim is one conditional update');
    expectTitle(ciDatabase, 'FD-6 the CI test job runs on a real Postgres');
    expectTitle(ciDatabase, 'FD-6 database tests never skip in CI');
    for (const path of [grantRace, claimsRace, storeRace, ciDatabase]) expectNotWeakened(path);
  });

  it('gates each race suite only on the test server, which the CI test job provides', () => {
    for (const path of [grantRace, claimsRace, storeRace]) {
      expect(source(path)).toContain('describe.skipIf(!testServer)');
    }
    expect(source('vitest.config.ts')).toContain("'apps/**/*.pg.test.ts'");
    const workflow = source('.github/workflows/ci.yml');
    expect(jobBlock(workflow, 'test')).toContain('image: postgres:16');
  });
});

type HandOffKey = string;

const datedRow = /^\| \d{4}-\d{2}-\d{2} \|/;
const handOffRow = /^\| (?:Not verified|Waiting on a person) \|/;

function sectionLines(tracker: string, heading: string): string[] {
  const lines = tracker.split('\n');
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

function cells(row: string): string[] {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function sourceKeys(tracker: string, heading: string, label: string): HandOffKey[] {
  return sectionLines(tracker, heading)
    .filter((line) => datedRow.test(line))
    .map((row) => {
      const [date, requirement] = cells(row);
      return `${label} | ${date ?? ''} | ${requirement ?? ''}`;
    });
}

function handOffKeys(tracker: string): HandOffKey[] {
  return sectionLines(tracker, '## Go-live hand-off')
    .filter((line) => handOffRow.test(line))
    .map((line) => cells(line).slice(0, 3).join(' | '));
}

const cutShort = ['(and the rest of the source row)', 'Check on the live service:'];

function wholeAction(row: readonly string[]): boolean {
  const [, , , action = '', who = ''] = row;
  const written = action.replace(/^[^:]*:/, '').trim().length > 0;
  return written && who.length > 0 && cutShort.every((marker) => !action.includes(marker));
}

describe('the go-live hand-off names every row a person must still close', () => {
  it('lists each Not verified and each Waiting on a person row once, by its section, date and requirement', () => {
    const tracker = source('docs/progress_tracker.md');
    const expected = [
      ...sourceKeys(tracker, '## Not verified', 'Not verified'),
      ...sourceKeys(tracker, '## Waiting on a person', 'Waiting on a person'),
    ].sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(handOffKeys(tracker).sort()).toEqual(expected);
  });

  it('gives every row a whole action and someone who acts', () => {
    const tracker = source('docs/progress_tracker.md');
    const rows = sectionLines(tracker, '## Go-live hand-off')
      .filter((line) => handOffRow.test(line))
      .map(cells);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !wholeAction(row))).toEqual([]);
  });
});
