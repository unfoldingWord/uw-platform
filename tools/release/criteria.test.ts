import { existsSync, readFileSync } from 'node:fs';
import { bypassesShip, templateProperty, templates } from '../../packages/harness/index.ts';
import { describe, expect, it } from 'vitest';
import { repositoryTrace } from '../trace/repository.ts';
import { traceExitCode } from '../trace/trace.ts';

const callArguments = /\.(?:each|skipIf|runIf)\([^()]*\)/g;
const titlePattern = /\b(?:describe|it|test)[.\w]*\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g;
const weakeners = /\b(?:describe|it|test)[.\w]*\.(?:skip|todo|fails|only)\b|\.skipIf\(\s*true\s*\)/;

const staticCheck = 'tools/architecture/agent-boundary.test.ts';
const runtimeCheck = 'sim/kernel/agent-boundary-runtime.test.ts';
const conformanceCheck = 'apps/uw-app/mcp/conformance.pg.test.ts';
const plantedConformance = 'apps/uw-app/testing/conformance.test.ts';
const grantRace = 'apps/uw-app/harness/grant-race.pg.test.ts';
const claimsRace = 'apps/uw-app/harness/claims.pg.test.ts';
const storeRace = 'packages/db/store/claim-race.test.ts';
const ciDatabase = 'tools/ci/test-database.test.ts';

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
  return weakeners.test(text);
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

describe('release criterion 2: every Must requirement has a scenario or a test named for it', () => {
  it('leaves no Must requirement unproven, so pnpm trace exits 0', () => {
    const report = repositoryTrace();
    expect(report.unproven.map((entry) => entry.id)).toEqual([]);
    expect(traceExitCode(report, 'all')).toBe(0);
  });
});

describe('release criterion 3, by structure: the DX-7 scenario and its coverage module exist (pnpm sim:all in item 1 runs it)', () => {
  it('keeps the scenario file named for DX-7 and the whole-journey checks', () => {
    expect(source('sim/scenarios/DX-7.software-template-end-to-end.ts')).toContain("id: 'DX-7'");
    expect(existsSync('sim/e2e/coverage.ts')).toBe(true);
  });
});

describe('release criterion 4: both templates pass the property and the negative fixture fails it', () => {
  it('passes software and bml, fails the fixture that bypasses Ship, and keeps both KN-10 cases', () => {
    expect([...templates.keys()].sort()).toEqual(['bml', 'software']);
    for (const template of templates.values()) {
      expect(templateProperty(template.stages)).toEqual([]);
    }
    expect(templateProperty(bypassesShip.stages).length).toBeGreaterThan(0);
    const property = 'packages/harness/template-property.test.ts';
    expectTitle(property, 'KN-10 every registered template');
    expectTitle(property, 'KN-10 the negative fixture');
    expectNotWeakened(property);
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
    const testJob = workflow.slice(workflow.indexOf('\n  test:'));
    expect(testJob).toContain('image: postgres:16');
  });
});
