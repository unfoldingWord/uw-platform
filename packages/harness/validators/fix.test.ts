import type { PullRequestDeclaration } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { FixContext, ValidationContext } from './context.ts';
import { fixKeepsPurpose, fixSizeCap, sameDeclaration, testOrDoc } from './fix.ts';
import { FIX_VALIDATORS, runValidators, validatorRegistry } from './registry.ts';

const declaration: PullRequestDeclaration = {
  closes: ['#12', '#14'],
  risks: 'the board renders slower on phones',
  touches: 'apps/uw-app/board',
  riskTier: 'standard',
  riskDomains: [],
};

const fits: FixContext = {
  pull: { lines: 40, paths: ['apps/board.tsx', 'apps/lane.tsx'] },
  fix: { lines: 10, paths: ['apps/board.tsx', 'apps/board.test.tsx', 'docs/board.md'] },
  declared: declaration,
  declaration,
  claimed: true,
  samePullRequest: true,
};

function context(fix: FixContext | null): ValidationContext {
  const item = {} as never;
  return { item, events: [], pages: new Map(), attaching: [], fix };
}

describe('FL-3 fix_size_cap and fix_keeps_purpose', () => {
  it('FL-3 both are in the validator registry and pass a fix that keeps to the rules', () => {
    expect(FIX_VALIDATORS.every((key) => validatorRegistry.has(key))).toBe(true);
    expect(runValidators(FIX_VALIDATORS, context(fits))).toEqual([]);
  });

  it('FL-3 fix_size_cap refuses more than a quarter of the pull request lines', () => {
    const over = { ...fits, fix: { ...fits.fix, lines: 11 } } as FixContext;
    expect(fixSizeCap(context(over))).toEqual([
      "fix_size_cap: the fix changes 11 lines, more than a quarter of the pull request's 40",
    ]);
  });

  it('FL-3 fix_size_cap refuses a file the pull request does not touch, but not a test or a doc', () => {
    const wider = { ...fits, fix: { lines: 4, paths: ['apps/billing.ts', 'apps/x.spec.ts'] } };
    expect(fixSizeCap(context(wider))).toEqual([
      'fix_size_cap: the fix touches apps/billing.ts, which the pull request does not',
    ]);
    expect(testOrDoc('apps/contest.ts')).toBe(false);
  });

  it('FL-3 fix_size_cap refuses a fix that changes nothing', () => {
    expect(fixSizeCap(context({ ...fits, fix: { lines: 0, paths: [] } }))).toEqual([
      'fix_size_cap: the fix changes nothing',
    ]);
  });

  it('FL-3 fix_keeps_purpose refuses a fix that names another pull request', () => {
    expect(fixKeepsPurpose(context({ ...fits, samePullRequest: false }))).toEqual([
      "fix_keeps_purpose: the fix names a pull request other than the item's",
    ]);
  });

  it('FL-3 fix_size_cap refuses a fix it cannot measure', () => {
    expect(fixSizeCap(context({ ...fits, fix: null }))).toHaveLength(1);
    expect(fixSizeCap(context({ ...fits, pull: null }))[0]).toMatch(/^fix_size_cap: /);
  });

  it('FL-3 fix_keeps_purpose refuses a changed declaration and reads closes as a set', () => {
    const reordered = { ...declaration, closes: ['#14', '#12'] };
    expect(sameDeclaration(declaration, reordered)).toBe(true);
    const changed = { ...fits, declaration: { ...declaration, touches: 'apps/uw-app/billing' } };
    expect(fixKeepsPurpose(context(changed))).toEqual([
      'fix_keeps_purpose: the pull request declaration changed since the fix was claimed',
    ]);
    expect(fixKeepsPurpose(context({ ...fits, declared: null, declaration: null }))).toEqual([]);
    expect(fixKeepsPurpose(context({ ...fits, claimed: false }))).toHaveLength(1);
  });

  it('FL-3 outside a fix both validators pass', () => {
    expect(runValidators(FIX_VALIDATORS, context(null))).toEqual([]);
  });
});

describe('FL-3 what a fix may touch beside the pull request', () => {
  it('FL-3 the test allowance reads a test name, or a tests directory at the root or a package root', () => {
    for (const path of [
      'a.pg.test.ts',
      'apps/uw-app/board.spec.tsx',
      'tests/board.ts',
      'test/fixtures/a.json',
      '__tests__/a.ts',
      'packages/db/tests/a.ts',
      'apps/uw-app/__tests__/a.ts',
    ]) {
      expect(testOrDoc(path)).toBe(true);
    }
    for (const path of [
      'src/__tests__/a.ts',
      'apps/uw-app/src/test/a.ts',
      'tests',
      'apps/test.ts',
    ]) {
      expect(testOrDoc(path)).toBe(false);
    }
  });

  it('FL-3 the doc allowance reads markdown under docs/, or a README or CHANGELOG', () => {
    for (const path of [
      'docs/board.md',
      'docs/adr/0001-a.md',
      'README.md',
      'packages/db/CHANGELOG.md',
    ]) {
      expect(testOrDoc(path)).toBe(true);
    }
    for (const path of [
      'docs/a.txt',
      'apps/uw-app/notes.md',
      'guide.md',
      'README.ts',
      'packages/db/CHANGELOG.mjs',
    ]) {
      expect(testOrDoc(path)).toBe(false);
    }
  });
});

describe('FL-3 what a fix may never touch beside the pull request', () => {
  it('FL-3 agent instructions, workflows, skills and personas are never allowed beside the pull request', () => {
    for (const path of [
      'AGENTS.md',
      'CLAUDE.md',
      'apps/uw-app/CLAUDE.md',
      '.claude/settings.json',
      '.claude/agents/reviewer.test.md',
      '.github/workflows/ci.yml',
      '.github/README.md',
      'skills/fix/SKILL.md',
      'docs/skills/fix.md',
      'docs/personas/builder.md',
      'tests/personas/builder.md',
      'packages/x/SKILL.md',
    ]) {
      expect(testOrDoc(path)).toBe(false);
    }
    const guardedTouch = { ...fits, fix: { lines: 2, paths: ['.github/workflows/ci.yml'] } };
    expect(fixSizeCap(context(guardedTouch))).toEqual([
      'fix_size_cap: the fix touches .github/workflows/ci.yml, which the pull request does not',
    ]);
    const already = {
      ...fits,
      pull: { lines: 40, paths: ['AGENTS.md'] },
      fix: { lines: 2, paths: ['AGENTS.md'] },
    };
    expect(fixSizeCap(context(already))).toEqual([]);
  });
});
