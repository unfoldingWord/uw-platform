import {
  ciJobSchema,
  defaultCiChecks,
  principalSchema,
  type ItemState,
  type PullRequestDeclaration,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { CheckFact, PullRequestFacts, ReviewFact } from '../ports.ts';
import {
  assembleShipInput,
  GITHUB_ACTIONS_APP,
  riskDerivedAtShip,
  reviewsOn,
  usableHead,
} from './ship-input.ts';

const at = new Date('2026-10-01T09:00:00.000Z');
const later = new Date('2026-10-01T09:05:00.000Z');
const ref = { repo: 'unfoldingWord/uw-platform', number: 42 };
const head = 'a'.repeat(40);
const older = 'b'.repeat(40);
const base = '0'.repeat(40);
const itemId = '00000000-0000-4000-8000-000000000301';
const harness = {
  jdArea: '80-89',
  repository: 'unfoldingWord/uw-platform',
  externalReviewerIdentities: [] as string[],
  requiredChecks: [...defaultCiChecks],
  frozen: false,
  freezeAllow: [] as string[],
};
const patchId = '1'.repeat(64);

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
    findings: [],
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
  baseRef: 'main',
  defaultBranch: 'main',
  checks: ciJobSchema.options.map((name) => check(name)),
  reviews: [review()],
  files: { head, base, paths: ['apps/uw-app/board.tsx'] },
  declaration: declared('standard'),
  closes: [],
  comparison: {
    head,
    base,
    behindBy: 0,
    patchId,
    commits: [{ sha: head, merge: false, skipCi: false, closes: [] }],
    patchIds: { [head]: patchId },
  },
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
      pullRequest: { open: true, draft: false, head, behindBy: 0, skipCi: false },
      expectedHead: head,
      carries: [],
      checks: ciJobSchema.options.map((name) => ({
        name,
        app: 'github-actions',
        headSha: head,
        conclusion: 'success',
      })),
      requiredChecks: [...defaultCiChecks],
      approvals: theApproval,
      closes: [],
      wraps: null,
      riskTier: 'standard',
      riskDomains: [],
      area: '80-89',
      approver,
      at: at.toISOString(),
      frozen: false,
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

describe('GH-5 SR-1 every check on the head counts, apart by app and name', () => {
  it('keeps a check named like a CI job from another app apart from the job', () => {
    const foreign = check('test', { checkId: 9100000077, app: 'some-other-app' });
    const read = withChecks(check('test'), foreign).map((entry) => [entry.app, entry.name]);
    expect(read).toEqual([
      ['github-actions', 'test'],
      ['some-other-app', 'test'],
    ]);
  });

  it('reads a check that is not a CI job and ignores checks on another head', () => {
    const read = withChecks(check('deploy-preview'), check('lint', { headSha: older }));
    expect(read.map((entry) => entry.name)).toEqual(['deploy-preview']);
  });

  it('lets the latest run of a job on the head decide', () => {
    const failed = check('test', { checkId: 1, conclusion: 'failure' });
    const green = check('test', { checkId: 2, conclusion: 'success' });
    expect(withChecks(failed, green)).toEqual([
      { name: 'test', app: 'github-actions', headSha: head, conclusion: 'success' },
    ]);
    const reversed = [
      { ...failed, checkId: 2 },
      { ...green, checkId: 1 },
    ];
    expect(withChecks(...reversed)).toEqual([
      { name: 'test', app: 'github-actions', headSha: head, conclusion: 'failure' },
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

describe('GH-5 a pull request counts only into its repository’s default branch', () => {
  it('reads nothing from a pull request retargeted to another branch', () => {
    expect(assembled({ facts: { baseRef: 'release' } })).toMatchObject(unusable);
    expect(riskDerivedAtShip(sourceOf({ facts: { baseRef: 'release' } }))).toBeNull();
  });

  it('reads nothing when the default branch was renamed away from the base', () => {
    expect(assembled({ facts: { defaultBranch: 'trunk' } })).toMatchObject(unusable);
  });

  it('reads the pull request into a renamed default branch', () => {
    const renamed = { baseRef: 'trunk', defaultBranch: 'trunk' };
    expect(assembled({ facts: renamed }).approvals).toEqual(theApproval);
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
  it('records the paths, declaration, result, head, repository and base it derived from', () => {
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
      repository: 'unfoldingWord/uw-platform',
      base: { sha: base, ref: 'main' },
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

describe('GL-3 a joined item counts its head without a harness branch', () => {
  it('reads the head of a joined pull request and still needs the branch once a harness branch exists', () => {
    const joined = { ...item, branchState: 'none' as const };
    const foreign = { ...facts, headRef: 'feature/login-form' };
    expect(usableHead(foreign, joined, harness)).toBe(head);
    expect(usableHead(foreign, item, harness)).toBeNull();
  });
});

describe('PI-1 the provider of an external approval is external', () => {
  it('lists the external reviewer beside the platform Reviewer in the gate view reviews', () => {
    const reviews = [
      review({ reviewId: 1 }),
      review({ reviewId: 2, reviewer: 'uwreview[bot]', provider: null }),
    ];
    const shown = reviewsOn({ ...facts, reviews }, head, ['uwreview[bot]']);
    expect(shown.map((entry) => [entry.reviewer, entry.provider])).toEqual([
      ['uw-reviewer', 'anthropic'],
      ['uwreview', 'external'],
    ]);
  });
});

describe('PI-1 an external approval counts once, on the head only', () => {
  const external = { ...harness, externalReviewerIdentities: ['uwreview', 'uwreview[bot]'] };
  const approvedWith = (...reviews: ReviewFact[]) =>
    assembleShipInput({ ...sourceOf({ facts: { reviews } }), harness: external }).approvals;

  it('PI-1 counts no external approval on an older head', () => {
    const old = review({ reviewId: 3, reviewer: 'uwreview[bot]', provider: null, commit: older });
    expect(approvedWith(old)).toEqual([]);
  });

  it('PI-1 collapses the login with and without [bot] into one external reviewer', () => {
    const plain = review({ reviewId: 3, reviewer: 'uwreview', provider: null });
    const bot = review({ reviewId: 4, reviewer: 'uwreview[bot]', provider: null });
    expect(approvedWith(plain, bot)).toEqual([
      { reviewer: 'uwreview', commit: head, provider: 'external' },
    ]);
  });

  it('PI-1 counts the platform Reviewer and an external reviewer as two on a standard change', () => {
    const outside = review({ reviewId: 3, reviewer: 'uwreview[bot]', provider: null });
    const counted = approvedWith(review(), outside);
    expect(counted.map((approval) => approval.reviewer)).toEqual(['uw-reviewer', 'uwreview']);
  });
});

describe('SR-1 SR-2 the assembler reads the comparison, the closing references, the required checks and the freeze', () => {
  const source = { facts, item, harness, approver, at, override: false };
  const compared = facts.comparison ?? {
    head,
    base,
    behindBy: 0,
    patchId,
    commits: [],
    patchIds: {},
  };

  it('SR-1 reads behind_by and the skip-ci markers from the comparison at this head and base', () => {
    const behind = { ...facts, comparison: { ...compared, behindBy: 2 } };
    expect(assembleShipInput({ ...source, facts: behind }).pullRequest).toMatchObject({
      behindBy: 2,
      skipCi: false,
    });
    const elsewhere = { ...facts, comparison: { ...compared, base: older } };
    expect(assembleShipInput({ ...source, facts: elsewhere }).pullRequest).toMatchObject({
      behindBy: null,
      skipCi: null,
    });
    const unread = { ...facts, comparison: { ...compared, commits: null } };
    expect(assembleShipInput({ ...source, facts: unread }).pullRequest?.skipCi).toBeNull();
  });

  it('SR-1 joins the body and commit closing references once each, and wraps the item issue', () => {
    const ref = { repo: 'unfoldingWord/uw-platform', number: 12 };
    const commits = [
      { sha: head, merge: false, skipCi: false, closes: [ref, { ...ref, number: 13 }] },
    ];
    const closing = { ...facts, closes: [ref], comparison: { ...compared, commits } };
    const input = assembleShipInput({ ...source, facts: closing });
    expect(input.closes).toEqual([ref, { ...ref, number: 13 }]);
    expect(input.wraps).toBeNull();
    const wrapping = { ...item, issue: { ...ref, githubId: 7 } };
    expect(assembleShipInput({ ...source, item: wrapping }).wraps).toEqual(ref);
    const unreadable = { ...closing, closes: null };
    expect(assembleShipInput({ ...source, facts: unreadable }).closes).toBeNull();
    const commitsUnread = { ...closing, comparison: { ...compared, commits: null } };
    expect(assembleShipInput({ ...source, facts: commitsUnread }).closes).toBeNull();
    const notCompared = { ...closing, comparison: null };
    expect(assembleShipInput({ ...source, facts: notCompared }).closes).toBeNull();
  });

  it('SR-1 GD-2 takes the required checks from the harness and the freeze unless the item is allowed', () => {
    expect(assembleShipInput(source).requiredChecks).toEqual(defaultCiChecks);
    const frozen = { ...harness, frozen: true };
    expect(assembleShipInput({ ...source, harness: frozen }).frozen).toBe(true);
    const allowed = { ...frozen, freezeAllow: [itemId] };
    expect(assembleShipInput({ ...source, harness: allowed }).frozen).toBe(false);
  });
});

describe('SR-2 the assembler carries an approval across a merge from base', () => {
  const source = { facts, item, harness, approver, at, override: false };

  it('SR-2 counts an approval on a carried commit with the commit it was given on', () => {
    const merged = 'd'.repeat(40);
    const commits = [
      { sha: head, merge: false, skipCi: false, closes: [] },
      { sha: merged, merge: true, skipCi: false, closes: [] },
    ];
    const patchIds = { [head]: patchId, [merged]: patchId };
    const comparison = { head: merged, base, behindBy: 0, patchId, commits, patchIds };
    const moved: PullRequestFacts = {
      ...facts,
      head: merged,
      comparison,
      checks: facts.checks.map((one) => ({ ...one, headSha: merged })),
      files: { head: merged, base, paths: ['apps/uw-app/board.tsx'] },
    };
    const input = assembleShipInput({ ...source, facts: moved });
    expect(input.carries).toEqual([head]);
    expect(input.approvals).toEqual([
      { reviewer: 'uw-reviewer', commit: head, provider: 'anthropic' },
    ]);
    const shown = reviewsOn(moved, merged, []);
    expect(shown.map((entry) => [entry.reviewer, entry.commit])).toEqual([['uw-reviewer', head]]);
    const rebased = { ...moved, comparison: { ...comparison, commits: commits.slice(1) } };
    expect(reviewsOn(rebased, merged, [])).toEqual([]);
  });
});
