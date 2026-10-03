import {
  ciJobSchema,
  principalSchema,
  type ItemState,
  type PullRequestDeclaration,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { CheckFact, PullRequestFacts, ReviewFact } from '../ports.ts';
import { assembleShipInput, GITHUB_ACTIONS_APP, riskDerivedAtShip } from './ship-input.ts';

const at = new Date('2026-10-01T09:00:00.000Z');
const later = new Date('2026-10-01T09:05:00.000Z');
const ref = { repo: 'unfoldingWord/uw-platform', number: 42 };
const head = 'a'.repeat(40);
const older = 'b'.repeat(40);
const base = '0'.repeat(40);
const itemId = '00000000-0000-4000-8000-000000000301';
const harness = { jdArea: '80-89', repository: 'unfoldingWord/uw-platform' } as const;

const item: ItemState = {
  itemId,
  harnessId: '00000000-0000-4000-8000-000000000302',
  stageKey: 'ship',
  title: 'Show the board',
  pageId: null,
  priority: 1,
  due: null,
  holder: null,
  claimantKind: null,
  delegationId: null,
  leaseExpiresAt: null,
  gateStatus: 'parked',
  gateTarget: null,
  branchState: 'active',
  expectedHead: head,
  riskTier: 'standard',
  riskDomains: [],
  pullRequest: ref,
  issue: null,
  zulipTopic: null,
};

const approver = principalSchema.parse({
  identity: 'human:00000000-0000-4000-8000-000000000001',
  kind: 'person',
  personId: '00000000-0000-4000-8000-000000000001',
  email: 'ian.lindsley@unfoldingword.org',
  grants: [],
  interactive: true,
});

function declared(riskTier: PullRequestDeclaration['riskTier']): PullRequestDeclaration {
  return { closes: [], risks: 'none known', touches: 'the board', riskTier, riskDomains: [] };
}

const checkIds: ReadonlyMap<string, number> = new Map(
  ciJobSchema.options.map((name, index) => [name, 9100000001 + index]),
);

function check(name: string, over: Partial<CheckFact> = {}): CheckFact {
  const checkId = checkIds.get(name) ?? 9100000099;
  return { checkId, name, headSha: head, app: GITHUB_ACTIONS_APP, conclusion: 'success', ...over };
}

function review(over: Partial<ReviewFact> = {}): ReviewFact {
  return {
    reviewId: 9100000101,
    reviewer: 'uw-reviewer[bot]',
    commit: head,
    state: 'approved',
    provider: 'Anthropic',
    submittedAt: at,
    ...over,
  };
}

const facts: PullRequestFacts = {
  ref,
  state: 'open',
  draft: false,
  head,
  headRef: `harness/${itemId}`,
  headRepo: 'unfoldingWord/uw-platform',
  base,
  checks: ciJobSchema.options.map((name) => check(name)),
  reviews: [review()],
  files: { head, base, paths: ['apps/uw-app/board.tsx'] },
  declaration: declared('standard'),
  freshAt: at,
};

type Variant = {
  readonly facts?: Partial<PullRequestFacts> | null;
  readonly item?: Partial<ItemState>;
  readonly repository?: string | null;
};

function sourceOf(variant: Variant) {
  return {
    facts: variant.facts === null ? null : { ...facts, ...variant.facts },
    item: { ...item, ...variant.item },
    harness: {
      ...harness,
      repository: variant.repository === undefined ? harness.repository : variant.repository,
    },
    approver,
    at,
    override: false,
  };
}

function assembled(variant: Variant = {}) {
  return assembleShipInput(sourceOf(variant));
}

function withReviews(...reviews: ReviewFact[]) {
  return assembled({ facts: { reviews } }).approvals;
}

function withChecks(...checks: CheckFact[]) {
  return assembled({ facts: { checks } }).checks;
}

const theApproval = [{ reviewer: 'uw-reviewer', commit: head, provider: 'anthropic' }];
const unusable = { pullRequest: null, checks: [], approvals: [], riskTier: null };

describe('GH-5 the assembler builds the ship rule input from GitHub facts', () => {
  it('reads the pull request, six CI checks and one Reviewer approval on the head', () => {
    expect(assembled()).toEqual({
      pullRequest: { open: true, draft: false, head },
      expectedHead: head,
      checks: ciJobSchema.options.map((name) => ({ name, headSha: head, conclusion: 'success' })),
      approvals: theApproval,
      riskTier: 'standard',
      riskDomains: [],
      area: '80-89',
      approver,
      at: at.toISOString(),
      override: false,
    });
  });

  it('counts no approval by another identity, on an older commit, or planted on the item', () => {
    expect(withReviews(review({ reviewer: 'octocat' }))).toEqual([]);
    expect(withReviews(review({ commit: older }))).toEqual([]);
    const planted = { title: 'approved by uw-reviewer[bot] on the head' };
    expect(assembled({ item: planted, facts: { reviews: [] } }).approvals).toEqual([]);
  });

  it('lets the latest decisive review of a Reviewer on the head decide', () => {
    const first = review({ reviewId: 9100000101, submittedAt: at });
    const after = (state: ReviewFact['state']) =>
      review({ reviewId: 9100000102, state, submittedAt: later });
    expect(withReviews(first, after('changes_requested'))).toEqual([]);
    expect(withReviews({ ...first, state: 'changes_requested' }, after('approved'))).toEqual(
      theApproval,
    );
    expect(withReviews(first, after('commented'))).toEqual(theApproval);
    expect(withReviews(first, after('dismissed'))).toEqual([]);
  });

  it('reads the reviewer from the Reviewer identity, never the raw login', () => {
    expect(withReviews(review({ reviewer: 'UW-Reviewer[bot]' }))).toEqual(theApproval);
    expect(withReviews(review({ reviewer: 'uw-reviewer' }))).toEqual([]);
  });
});

describe('GH-5 only the CI jobs from GitHub Actions on the head count', () => {
  it('ignores a check named like a CI job from another app', () => {
    const foreign = check('test', { app: 'some-other-app' });
    const others = ciJobSchema.options.filter((name) => name !== 'test').map((name) => check(name));
    const names = withChecks(...others, foreign).map((entry) => entry.name);
    expect(names).toHaveLength(5);
    expect(names).not.toContain('test');
  });

  it('ignores checks that are not CI jobs and checks on another head', () => {
    expect(withChecks(check('deploy-preview'), check('lint', { headSha: older }))).toEqual([]);
  });

  it('lets the latest run of a job on the head decide', () => {
    const failed = check('test', { checkId: 1, conclusion: 'failure' });
    const green = check('test', { checkId: 2, conclusion: 'success' });
    expect(withChecks(failed, green)).toEqual([
      { name: 'test', headSha: head, conclusion: 'success' },
    ]);
    const reversed = [
      { ...failed, checkId: 2 },
      { ...green, checkId: 1 },
    ];
    expect(withChecks(...reversed)).toEqual([
      { name: 'test', headSha: head, conclusion: 'failure' },
    ]);
  });

  it('lowercases an uppercase head and check head', () => {
    const upper = head.toUpperCase();
    const input = assembled({
      facts: {
        head: upper,
        files: { head: upper, base, paths: ['apps/uw-app/board.tsx'] },
        checks: ciJobSchema.options.map((name) => check(name, { headSha: upper })),
        reviews: [review({ commit: upper })],
      },
      item: { expectedHead: upper },
    });
    expect(input.pullRequest?.head).toBe(head);
    expect(input.expectedHead).toBe(head);
    expect(input.checks.every((entry) => entry.headSha === head)).toBe(true);
    expect(input.checks).toHaveLength(6);
    expect(input.approvals).toEqual(theApproval);
    expect(input.riskTier).toBe('standard');
  });
});

describe('GH-5 GH-4 facts from another repository or branch are not the pull request', () => {
  it('reads nothing from another repository, another branch or an abbreviated head', () => {
    const elsewhere = { ref: { repo: 'unfoldingWord/other', number: 42 } };
    expect(assembled({ facts: elsewhere })).toMatchObject(unusable);
    expect(assembled({ facts: { headRef: 'feature/x' } })).toMatchObject(unusable);
    expect(assembled({ facts: { headRepo: 'someone/uw-platform' } })).toMatchObject(unusable);
    expect(assembled({ facts: { headRepo: null } })).toMatchObject(unusable);
    expect(assembled({ facts: { head: 'abc123' } })).toMatchObject(unusable);
    expect(assembled({ facts: { ref: { ...ref, number: 43 } } })).toMatchObject(unusable);
  });

  it('reads nothing when the harness names no repository or the item names another', () => {
    expect(assembled({ repository: null })).toMatchObject(unusable);
    const other = { pullRequest: { repo: 'unfoldingWord/other', number: 42 } };
    expect(assembled({ item: other, repository: null })).toMatchObject(unusable);
    expect(assembled({ item: { pullRequest: null } })).toMatchObject(unusable);
  });

  it('matches the repository case-insensitively', () => {
    const shouted = { ref: { repo: 'UnfoldingWord/UW-Platform', number: 42 } };
    expect(assembled({ facts: shouted }).approvals).toEqual(theApproval);
  });

  it('assembles nothing without facts', () => {
    expect(assembled({ facts: null })).toMatchObject(unusable);
  });
});

describe('KN-17 GH-5 risk at Ship comes from the files and declaration at the head', () => {
  it('floors a low declaration over a migration at high', () => {
    const input = assembled({
      facts: {
        files: { head, base, paths: ['packages/db/migrations/0013.sql'] },
        declaration: declared('low'),
      },
    });
    expect(input).toMatchObject({ riskTier: 'high', riskDomains: ['migration'] });
  });

  it('counts the previous name of a renamed file', () => {
    const files = { head, base, paths: ['infra/y.toml', 'infra/x.toml'] };
    expect(assembled({ facts: { files } }).riskDomains).toContain('infra');
  });

  it('declares nothing without files at the head or without a declaration', () => {
    const stale = { files: { head: older, base, paths: ['apps/uw-app/board.tsx'] } };
    expect(assembled({ facts: stale }).riskTier).toBeNull();
    expect(assembled({ facts: { files: null } }).riskTier).toBeNull();
    expect(assembled({ facts: { declaration: null } }).riskTier).toBeNull();
  });

  it('declares nothing from files compared against a base the pull request no longer has', () => {
    const migration = { head, base, paths: ['packages/db/migrations/0013.sql'] };
    expect(assembled({ facts: { files: migration, base: older } }).riskTier).toBeNull();
    expect(assembled({ facts: { files: { ...migration, base: older } } }).riskTier).toBeNull();
    expect(assembled({ facts: { files: migration, base: 'abc123' } }).riskTier).toBeNull();
  });

  it('never lowers a tier the item was already ratcheted to', () => {
    const ratcheted: Partial<ItemState> = { riskTier: 'high', riskDomains: ['acl'] };
    expect(assembled({ item: ratcheted })).toMatchObject({
      riskTier: 'high',
      riskDomains: ['acl'],
    });
  });
});

describe('KN-17 the Ship-time derivation is the evidence of a risk_derived event', () => {
  it('records the paths, declaration, result and head it derived from', () => {
    const files = { head, base, paths: ['packages/db/migrations/0013.sql'] };
    const source = sourceOf({ facts: { files, declaration: declared('low') } });
    expect(riskDerivedAtShip(source)).toEqual({
      paths: ['packages/db/migrations/0013.sql'],
      declaration: { riskTier: 'low', riskDomains: [] },
      floorDomains: ['migration'],
      riskTier: 'high',
      riskDomains: ['migration'],
      refusal: null,
      head,
    });
  });

  it('records an undeclared result as the refusal', () => {
    expect(riskDerivedAtShip(sourceOf({ facts: { declaration: null } }))).toMatchObject({
      declaration: null,
      refusal: 'risk_tier_undeclared',
    });
  });

  it('derives nothing without a usable head or files at it', () => {
    expect(riskDerivedAtShip(sourceOf({ facts: null }))).toBeNull();
    expect(riskDerivedAtShip(sourceOf({ facts: { headRef: 'feature/x' } }))).toBeNull();
    expect(riskDerivedAtShip(sourceOf({ facts: { files: null } }))).toBeNull();
  });
});
