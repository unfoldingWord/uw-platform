import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBuildOrder, parseRequirements } from './prd.ts';
import { scenarioProofs, testProofs } from './proofs.ts';
import { repositoryTrace } from './repository.ts';
import { completedSteps } from './tracker.ts';
import { formatTrace, trace, traceExitCode } from './trace.ts';

const fixturePrd = [
  '## 7. Requirements',
  '| ID | Requirement | Priority | Source |',
  '|---|---|---|---|',
  '| ZZ-1 | Built already. | Built | #1 |',
  '| ZZ-2 | Must one, with `a`, `b` inside. | Must | #2, D4 |',
  '| ZZ-3 | Later. | Later | #3 |',
  '| ZZ-4 | Must two. | Must | architecture.md |',
  '| ZZ-5 | Must three. | Must | #5 |',
  '| ZZ-6 | Must, unplaced. | Must | #6 |',
  '## 13. Build order',
  '',
  '1. **First.** ZZ-1, ZZ-2.',
  '2. **Second.** ZZ-4 to ZZ-5 and ZZ-3: words.',
  '## 14. Release criteria',
  '3. **Not a step.** ZZ-6.',
].join('\n');

const fixtureTracker = [
  '| Step | Requirements | State | Evidence |',
  '|---|---|---|---|',
  '| 1. First | ZZ-1 | Built | x |',
  '| 2. Second | ZZ-4 | done | |',
  '| 3. Third | ZZ-9 | Not started | |',
  '| 2026-10-01 | ZZ-1 | Built | why | cost |',
].join('\n');

function fixtureReport(proven: readonly string[]) {
  return trace({
    requirements: parseRequirements(fixturePrd),
    steps: parseBuildOrder(fixturePrd),
    completed: new Set([1]),
    proven: new Set(proven),
  });
}

function realPrd(): string {
  return readFileSync('docs/PRD.md', 'utf8');
}

function idsOfStep(step: number): readonly string[] | undefined {
  return parseBuildOrder(realPrd()).find((entry) => entry.step === step)?.ids;
}

describe('DX-5 trace reads the PRD', () => {
  it('reads every requirement row with its priority', () => {
    expect(parseRequirements(fixturePrd)).toEqual([
      { id: 'ZZ-1', priority: 'Built' },
      { id: 'ZZ-2', priority: 'Must' },
      { id: 'ZZ-3', priority: 'Later' },
      { id: 'ZZ-4', priority: 'Must' },
      { id: 'ZZ-5', priority: 'Must' },
      { id: 'ZZ-6', priority: 'Must' },
    ]);
  });

  it('expands ranges, keeps text order and stops at the end of section 13', () => {
    expect(parseBuildOrder(fixturePrd)).toEqual([
      { step: 1, ids: ['ZZ-1', 'ZZ-2'] },
      { step: 2, ids: ['ZZ-4', 'ZZ-5', 'ZZ-3'] },
    ]);
  });

  it('reads the real PRD', () => {
    const requirements = parseRequirements(realPrd());
    const ids = requirements.map((requirement) => requirement.id);
    expect(idsOfStep(2)).toEqual(['DX-1', 'DX-2', 'DX-3', 'DX-4', 'DX-5', 'DX-6', 'DX-8']);
    expect(idsOfStep(11)).toEqual(['DX-7']);
    expect(parseBuildOrder(realPrd()).some((step) => step.ids.includes('CT-3'))).toBe(false);
    expect(requirements.find((requirement) => requirement.id === 'CT-3')?.priority).toBe('Must');
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('DX-5 trace reads the tracker and the proofs', () => {
  it('lists the steps the tracker marks Built or Done', () => {
    expect(completedSteps(fixtureTracker)).toEqual(new Set([1, 2]));
  });

  it('counts a scenario file named for an ID', () => {
    expect(
      scenarioProofs([
        'sim/scenarios/ZZ-4.something-real.ts',
        'sim/scenarios/notes.ts',
        'sim/runner/ZZ-5.x.ts',
      ]),
    ).toEqual(['ZZ-4']);
  });

  it('counts a test title that leads with an ID and a word', () => {
    const source = [
      "describe('ZZ-2 ZZ-5 two at once', () => {",
      'it(`ZZ-6 in a template ${x}`, () => {});',
      "expect(code).toBe('ZZ-7')",
    ].join('\n');
    expect(testProofs(source)).toEqual(['ZZ-2', 'ZZ-5', 'ZZ-6']);
  });
});

describe('DX-5 trace decides what is due', () => {
  it('counts only Must requirements and marks what is due', () => {
    expect(fixtureReport(['ZZ-2', 'ZZ-4'])).toEqual({
      must: 4,
      proven: 2,
      unproven: [
        { id: 'ZZ-5', step: 2, due: false },
        { id: 'ZZ-6', step: null, due: true },
      ],
    });
  });

  it('fails built mode only on an unproven requirement that is due', () => {
    expect(traceExitCode(fixtureReport(['ZZ-2', 'ZZ-4']), 'built')).toBe(1);
    const dueProven = fixtureReport(['ZZ-2', 'ZZ-4', 'ZZ-6']);
    expect(traceExitCode(dueProven, 'built')).toBe(0);
    expect(traceExitCode(dueProven, 'all')).toBe(1);
  });

  it('prints the due list, then the not yet built list', () => {
    expect(formatTrace(fixtureReport(['ZZ-2', 'ZZ-4']))).toBe(
      [
        'trace: 4 Must requirements not marked Built; 2 proven, 2 unproven',
        'unproven and due:',
        '  ZZ-6  (in no build-order step)',
        'unproven, step not yet built:',
        '  ZZ-5  (step 2)',
      ].join('\n'),
    );
  });

  it('prints only the first line when nothing is unproven', () => {
    expect(formatTrace(fixtureReport(['ZZ-2', 'ZZ-4', 'ZZ-5', 'ZZ-6']))).toBe(
      'trace: 4 Must requirements not marked Built; 4 proven, 0 unproven',
    );
  });
});

describe('DX-5 the repository passes trace in built mode', () => {
  it('has every due Must requirement proven', () => {
    const report = repositoryTrace();
    expect(report.unproven.filter((entry) => entry.due)).toEqual([]);
    expect(traceExitCode(report, 'built')).toBe(0);
  });
});
