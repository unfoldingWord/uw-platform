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
  '| ZZ-4 | Should. | Should | #4 |',
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

function trackerWith(rows: readonly string[]): string {
  return [
    '## Status by build-order step',
    '',
    '| Step | Requirements | State | Evidence |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Decisions',
    '| 2026-10-01 | ZZ-1 | Built | why | cost |',
  ].join('\n');
}

const fixtureTracker = trackerWith([
  '| 0. Zero | ZZ-0 | Built | x |',
  '| 1. First | ZZ-1 | Built | x |',
  '| 2. Second | ZZ-4 | done | |',
  '| 3. Third | ZZ-9 | Not started | |',
]);

const fixtureStepNumbers = [1, 2, 3];

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
      { id: 'ZZ-4', priority: 'Should' },
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

  it('throws on a requirement row whose priority is malformed', () => {
    for (const bad of ['must', 'Must*', 'Maybe']) {
      const prd = fixturePrd.replace(
        '| ZZ-4 | Must two. | Must |',
        `| ZZ-4 | Must two. | ${bad} |`,
      );
      expect(() => parseRequirements(prd)).toThrow(/ZZ-4/);
    }
  });

  it('throws on a build-order ID with no requirement row and on an ID in two steps', () => {
    const unknown = fixturePrd.replace('ZZ-1, ZZ-2.', 'ZZ-1, ZZ-2, ZZ-99.');
    expect(() => parseBuildOrder(unknown)).toThrow(/ZZ-99/);
    const twice = fixturePrd.replace('ZZ-1, ZZ-2.', 'ZZ-1, ZZ-2, ZZ-4.');
    expect(() => parseBuildOrder(twice)).toThrow(/ZZ-4/);
  });

  it('keeps ranges and single IDs in true text order', () => {
    const prd = fixturePrd
      .replace('ZZ-1, ZZ-2.', 'ZZ-2, ZZ-1 and ZZ-4 to ZZ-5, ZZ-3.')
      .replace('ZZ-4 to ZZ-5 and ZZ-3: words.', 'words.');
    expect(parseBuildOrder(prd)[0]?.ids).toEqual(['ZZ-2', 'ZZ-1', 'ZZ-4', 'ZZ-5', 'ZZ-3']);
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
    expect(completedSteps(fixtureTracker, fixtureStepNumbers)).toEqual(new Set([0, 1, 2]));
  });

  it('accepts every state in the closed set, in any case', () => {
    const rows = ['Not started', 'IN PROGRESS', ' built '].map(
      (state, index) => `| ${index}. S | ZZ-${index} | ${state} | |`,
    );
    expect(completedSteps(trackerWith(rows), [1, 2])).toEqual(new Set([2]));
  });

  it('throws on a state outside the closed set', () => {
    for (const state of ['**Built**', 'Built (2026-10-01)', 'Bult', '']) {
      const rows = fixtureTracker.split('\n').map((row) => row.replace('| done |', `| ${state} |`));
      expect(() => completedSteps(rows.join('\n'), fixtureStepNumbers)).toThrow(/state/i);
    }
  });

  it('throws on a missing step row, an extra step row and a row with an extra column', () => {
    const without = fixtureTracker.replace('| 3. Third | ZZ-9 | Not started | |\n', '');
    expect(() => completedSteps(without, fixtureStepNumbers)).toThrow(/step 3/);
    const extra = fixtureTracker.replace(
      '\n\n## Decisions',
      '\n| 4. Fourth | ZZ-8 | Built | |\n\n## Decisions',
    );
    expect(() => completedSteps(extra, fixtureStepNumbers)).toThrow(/step 4/);
    const wide = fixtureTracker.replace('| done | |', '| done | | extra |');
    expect(() => completedSteps(wide, fixtureStepNumbers)).toThrow(/row/i);
  });

  it('throws when the section is absent', () => {
    expect(() => completedSteps('| 1. First | ZZ-1 | Built | x |', [1])).toThrow(
      /Status by build-order step/,
    );
  });

  it('reads the real tracker', () => {
    const steps = parseBuildOrder(realPrd()).map((entry) => entry.step);
    const completed = completedSteps(readFileSync('docs/progress_tracker.md', 'utf8'), steps);
    expect(completed.has(0)).toBe(true);
    expect(completed.has(1)).toBe(true);
  });
});

describe('DX-5 trace reads the proofs', () => {
  it('counts a scenario file named for an ID', () => {
    expect(
      scenarioProofs([
        'sim/scenarios/ZZ-4.something-real.ts',
        'sim/scenarios/notes.ts',
        'sim/runner/ZZ-5.x.ts',
      ]),
    ).toEqual(['ZZ-4']);
  });

  it('counts only titles that are the first argument of describe, it or test', () => {
    const counted = [
      "describe('ZZ-1 a', () => {})",
      "it.each([1, 2])('ZZ-2 b %s', () => {})",
      "describe.skipIf(!server)('ZZ-3 c', () => {})",
      "test.concurrent('ZZ-4 d', () => {})",
      "describe.runIf(a.b(1))('ZZ-5 e', () => {})",
      'it.sequential(`ZZ-6 f`, () => {})',
    ].join('\n');
    expect(testProofs(counted)).toEqual(['ZZ-1', 'ZZ-2', 'ZZ-3', 'ZZ-4', 'ZZ-5', 'ZZ-6']);
  });

  it('does not count todo, skipped or failing tests, thrown messages or fixtures', () => {
    const ignored = [
      "it.todo('ZZ-1 a')",
      "describe.skip('ZZ-2 b', () => {})",
      "it.fails('ZZ-3 c', () => {})",
      "test.skip.each([1])('ZZ-4 d', () => {})",
      "expect(run).toThrow('ZZ-5 e')",
      "const title = 'ZZ-6 f';",
      "log.it('ZZ-7 g')",
    ].join('\n');
    expect(testProofs(ignored)).toEqual([]);
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
        'trace: 4 Must requirements; 2 proven, 2 unproven (1 due, 1 in steps not yet built)',
        'unproven and due:',
        '  ZZ-6  (in no build-order step)',
        'unproven, step not yet built:',
        '  ZZ-5  (step 2)',
      ].join('\n'),
    );
  });

  it('prints only the first line when nothing is unproven', () => {
    expect(formatTrace(fixtureReport(['ZZ-2', 'ZZ-4', 'ZZ-5', 'ZZ-6']))).toBe(
      'trace: 4 Must requirements; 4 proven, 0 unproven (0 due, 0 in steps not yet built)',
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

describe('DX-9 the trace reads the v0.2.0 requirements', () => {
  const v2Prefixes = ['GL', 'MD', 'FL', 'UC', 'EI', 'SR', 'GD', 'RV', 'OB', 'PI'];
  const isV2 = (id: string) =>
    v2Prefixes.includes(id.slice(0, 2)) || id === 'DX-9' || id === 'DX-10';

  it('parses every section 7.11 row, Must and Should, without counting a Should as a Must', () => {
    const requirements = parseRequirements(realPrd());
    const v2 = requirements.filter((requirement) => isV2(requirement.id));
    expect(v2.length).toBe(43);
    expect(v2.filter((requirement) => requirement.priority === 'Should').map((r) => r.id)).toEqual([
      'GL-5',
      'UC-5',
      'EI-5',
      'RV-3',
      'OB-4',
    ]);
    expect(v2.filter((requirement) => requirement.priority === 'Must').length).toBe(38);
  });

  it('places every v0.2.0 ID in a step from 12 to 20 and none in steps 1 to 11', () => {
    const steps = parseBuildOrder(realPrd());
    const placedSteps: number[] = [];
    for (const step of steps) {
      for (const id of step.ids) if (isV2(id)) placedSteps.push(step.step);
    }
    expect(placedSteps.length).toBe(43);
    for (const step of placedSteps) expect(step).toBeGreaterThanOrEqual(12);
    for (const step of placedSteps) expect(step).toBeLessThanOrEqual(20);
    expect(idsOfStep(12)).toEqual(['DX-9']);
    expect(idsOfStep(20)).toEqual(['DX-10', 'GL-1']);
  });

  it('reports an unproven v0.2.0 Must as not yet due while its step is not built', () => {
    const report = repositoryTrace();
    const v2Unproven = report.unproven.filter((entry) => isV2(entry.id));
    for (const entry of v2Unproven) expect(entry.due).toBe(false);
    expect(traceExitCode(report, 'built')).toBe(0);
  });
});
