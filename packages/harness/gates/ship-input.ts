import {
  ciJobSchema,
  type EventEvidence,
  type Harness,
  type ItemState,
  type Principal,
  type ShipRuleInput,
} from '@uw/contracts';
import { riskDeclarationOf } from '../github/declaration.ts';
import { branchFor, fullSha, normalisedIdentifier, sameRepository } from '../github/identifiers.ts';
import { reviewerOf } from '../github/reviewers.ts';
import type { CheckFact, PullRequestFacts, ReviewFact, ReviewState } from '../ports.ts';
import { applyDeclaration, carryForward, floorFromPaths } from '../risk/derive.ts';

type ShipHarness = Pick<Harness, 'jdArea' | 'repository'>;

type ShipInputSource = {
  readonly facts: PullRequestFacts | null;
  readonly item: ItemState;
  readonly harness: ShipHarness;
  readonly approver: Principal;
  readonly at: Date;
  readonly override: boolean;
};

type RiskDerived = EventEvidence['risk_derived'];

export const GITHUB_ACTIONS_APP = 'github-actions';

const decisive: ReadonlySet<ReviewState> = new Set<ReviewState>([
  'approved',
  'changes_requested',
  'dismissed',
]);
const ciJobs: ReadonlySet<string> = new Set(ciJobSchema.options);

function usableHead(
  facts: PullRequestFacts | null,
  item: ItemState,
  harness: ShipHarness,
): string | null {
  if (facts === null || item.pullRequest === null) return null;
  if (!sameRepository(facts.ref.repo, harness.repository)) return null;
  if (!sameRepository(facts.ref.repo, item.pullRequest.repo)) return null;
  if (facts.ref.number !== item.pullRequest.number) return null;
  if (facts.headRef !== branchFor(item.itemId)) return null;
  return fullSha(facts.head);
}

function latestChecks(facts: PullRequestFacts, head: string): ShipRuleInput['checks'] {
  const latest = new Map<string, CheckFact>();
  for (const check of facts.checks) {
    if (fullSha(check.headSha) !== head) continue;
    if (check.app !== GITHUB_ACTIONS_APP || !ciJobs.has(check.name)) continue;
    const seen = latest.get(check.name);
    if (seen === undefined || check.checkId > seen.checkId) latest.set(check.name, check);
  }
  return [...latest.values()].map((check) => ({
    name: check.name,
    headSha: head,
    conclusion: check.conclusion,
  }));
}

function submittedTime(review: ReviewFact): number {
  return review.submittedAt?.getTime() ?? 0;
}

function later(a: ReviewFact, b: ReviewFact): boolean {
  const [left, right] = [submittedTime(a), submittedTime(b)];
  return left === right ? a.reviewId > b.reviewId : left > right;
}

function approvalsOn(facts: PullRequestFacts, head: string): ShipRuleInput['approvals'] {
  const latest = new Map<string, ReviewFact>();
  for (const review of facts.reviews) {
    const reviewer = reviewerOf(review.reviewer);
    if (reviewer === null || fullSha(review.commit) !== head || !decisive.has(review.state)) {
      continue;
    }
    const seen = latest.get(reviewer);
    if (seen === undefined || later(review, seen)) latest.set(reviewer, review);
  }
  return [...latest.entries()]
    .filter(([, review]) => review.state === 'approved')
    .map(([reviewer, review]) => ({
      reviewer,
      commit: head,
      provider: review.provider === null ? null : normalisedIdentifier(review.provider),
    }));
}

function derivedAt(facts: PullRequestFacts, item: ItemState, head: string): RiskDerived | null {
  if (facts.files === null || fullSha(facts.files.head) !== head) return null;
  const paths = [...facts.files.paths];
  const held = { tier: item.riskTier, domains: item.riskDomains };
  const floor = carryForward(floorFromPaths(paths), held);
  const declaration = riskDeclarationOf(facts.declaration);
  const result = applyDeclaration(floor, declaration);
  return {
    paths,
    declaration,
    floorDomains: [...floor.domains],
    riskTier: result.ok ? result.tier : floor.tier,
    riskDomains: [...result.domains],
    refusal: result.ok ? null : result.reason,
    head,
  };
}

function riskAtHead(
  facts: PullRequestFacts,
  item: ItemState,
  head: string,
): Pick<ShipRuleInput, 'riskTier' | 'riskDomains'> {
  const derived = derivedAt(facts, item, head);
  if (derived === null) return { riskTier: null, riskDomains: [...item.riskDomains] };
  return {
    riskTier: derived.refusal === null ? derived.riskTier : null,
    riskDomains: [...derived.riskDomains],
  };
}

function fromFacts(
  source: ShipInputSource,
): Pick<ShipRuleInput, 'pullRequest' | 'checks' | 'approvals' | 'riskTier' | 'riskDomains'> {
  const { facts, item } = source;
  const head = usableHead(facts, item, source.harness);
  if (facts === null || head === null) {
    return {
      pullRequest: null,
      checks: [],
      approvals: [],
      riskTier: null,
      riskDomains: [...item.riskDomains],
    };
  }
  return {
    pullRequest: { open: facts.state === 'open', draft: facts.draft, head },
    checks: latestChecks(facts, head),
    approvals: approvalsOn(facts, head),
    ...riskAtHead(facts, item, head),
  };
}

export function assembleShipInput(source: ShipInputSource): ShipRuleInput {
  const { item } = source;
  return {
    ...fromFacts(source),
    expectedHead: item.expectedHead === null ? null : fullSha(item.expectedHead),
    area: source.harness.jdArea,
    approver: source.approver,
    at: source.at.toISOString(),
    override: source.override,
  };
}

export function riskDerivedAtShip(source: ShipInputSource): RiskDerived | null {
  const { facts, item } = source;
  const head = usableHead(facts, item, source.harness);
  return facts === null || head === null ? null : derivedAt(facts, item, head);
}
