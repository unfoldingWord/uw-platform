import {
  ciJobSchema,
  type EventEvidence,
  type GateView,
  type Harness,
  type ItemState,
  type Principal,
  type ShipRuleInput,
} from '@uw/contracts';
import { pathsComparedAt } from '../github/changed-files.ts';
import { riskDeclarationOf } from '../github/declaration.ts';
import { branchFor, fullSha, normalisedIdentifier, sameRepository } from '../github/identifiers.ts';
import { reviewerOf } from '../github/reviewers.ts';
import type { CheckFact, PullRequestFacts, ReviewFact, ReviewState } from '../ports.ts';
import { applyDeclaration, carryForward, floorFromPaths } from '../risk/derive.ts';

type ShipHarness = Pick<Harness, 'jdArea' | 'repository'>;

export type ShipInputSource = {
  readonly facts: PullRequestFacts | null;
  readonly item: ItemState;
  readonly harness: ShipHarness;
  readonly approver: Principal;
  readonly at: Date;
  readonly override: boolean;
};

type RiskDerived = EventEvidence['risk_derived'];

export const GITHUB_ACTIONS_APP = 'github-actions';

type DecisiveState = Exclude<ReviewState, 'commented'>;
type DecisiveReview = ReviewFact & { readonly state: DecisiveState };

const decisive: ReadonlySet<ReviewState> = new Set<DecisiveState>([
  'approved',
  'changes_requested',
  'dismissed',
]);
const ciJobs: ReadonlySet<string> = new Set(ciJobSchema.options);

export function usableHead(
  facts: PullRequestFacts | null,
  item: ItemState,
  harness: ShipHarness,
): string | null {
  if (facts === null || item.pullRequest === null) return null;
  if (!sameRepository(facts.ref.repo, harness.repository)) return null;
  if (facts.headRepo === null || !sameRepository(facts.headRepo, harness.repository)) return null;
  if (!sameRepository(facts.ref.repo, item.pullRequest.repo)) return null;
  if (facts.ref.number !== item.pullRequest.number) return null;
  if (facts.headRef !== branchFor(item.itemId)) return null;
  if (facts.baseRef !== facts.defaultBranch) return null;
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

function isDecisive(review: ReviewFact): review is DecisiveReview {
  return decisive.has(review.state);
}

function latestDecisive(facts: PullRequestFacts, head: string): Map<string, DecisiveReview> {
  const latest = new Map<string, DecisiveReview>();
  for (const review of facts.reviews) {
    const reviewer = reviewerOf(review.reviewer);
    if (reviewer === null || fullSha(review.commit) !== head || !isDecisive(review)) continue;
    const seen = latest.get(reviewer);
    if (seen === undefined || later(review, seen)) latest.set(reviewer, review);
  }
  return latest;
}

function providerOf(review: ReviewFact): string | null {
  return review.provider === null ? null : normalisedIdentifier(review.provider);
}

function approvalsOn(facts: PullRequestFacts, head: string): ShipRuleInput['approvals'] {
  return [...latestDecisive(facts, head).entries()]
    .filter(([, review]) => review.state === 'approved')
    .map(([reviewer, review]) => ({ reviewer, commit: head, provider: providerOf(review) }));
}

export function reviewsOn(facts: PullRequestFacts, head: string): GateView['reviews'] {
  return [...latestDecisive(facts, head).entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([reviewer, review]) => ({
      reviewer,
      commit: head,
      state: review.state,
      provider: providerOf(review),
      findings: [...review.findings],
    }));
}

function decidedBaseOf(facts: PullRequestFacts): RiskDerived['base'] {
  const sha = fullSha(facts.base);
  return sha === null ? null : { sha, ref: facts.baseRef };
}

function derivedAt(
  facts: PullRequestFacts,
  source: ShipInputSource,
  head: string,
): RiskDerived | null {
  const { item } = source;
  const compared = pathsComparedAt(facts, head);
  if (compared === null) return null;
  const paths = [...compared];
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
    repository: source.harness.repository,
    base: decidedBaseOf(facts),
  };
}

function riskAtHead(
  facts: PullRequestFacts,
  source: ShipInputSource,
  head: string,
): Pick<ShipRuleInput, 'riskTier' | 'riskDomains'> {
  const derived = derivedAt(facts, source, head);
  if (derived === null) return { riskTier: null, riskDomains: [...source.item.riskDomains] };
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
    ...riskAtHead(facts, source, head),
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
  return facts === null || head === null ? null : derivedAt(facts, source, head);
}
