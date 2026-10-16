import {
  type ClosingRef,
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
import { countedReviewer, EXTERNAL_PROVIDER } from '../github/reviewers.ts';
import type {
  BaseComparison,
  CheckFact,
  PullRequestFacts,
  ReviewFact,
  ReviewState,
} from '../ports.ts';
import { applyDeclaration, carryForward, floorFromPaths } from '../risk/derive.ts';
import { carriedCommits } from './carry.ts';

type ShipHarness = Pick<
  Harness,
  | 'jdArea'
  | 'repository'
  | 'externalReviewerIdentities'
  | 'requiredChecks'
  | 'frozen'
  | 'freezeAllow'
>;

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
const CLOSES_LIMIT = 100;

function onItemBranch(facts: PullRequestFacts, item: ItemState): boolean {
  return item.branchState === 'none' || facts.headRef === branchFor(item.itemId);
}

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
  if (!onItemBranch(facts, item)) return null;
  if (facts.baseRef !== facts.defaultBranch) return null;
  return fullSha(facts.head);
}

function latestChecks(facts: PullRequestFacts, head: string): ShipRuleInput['checks'] {
  const latest = new Map<string, CheckFact>();
  for (const check of facts.checks) {
    if (fullSha(check.headSha) !== head) continue;
    const key = `${check.app ?? ''} ${check.name}`;
    const seen = latest.get(key);
    if (seen === undefined || check.checkId > seen.checkId) latest.set(key, check);
  }
  return [...latest.values()].map((check) => ({
    name: check.name,
    app: check.app,
    headSha: head,
    conclusion: check.conclusion,
  }));
}

function submittedTime(review: ReviewFact): number {
  return review.submittedAt?.getTime() ?? 0;
}

export function reviewedLater(a: ReviewFact, b: ReviewFact): boolean {
  const [left, right] = [submittedTime(a), submittedTime(b)];
  return left === right ? a.reviewId > b.reviewId : left > right;
}

function isDecisive(review: ReviewFact): review is DecisiveReview {
  return decisive.has(review.state);
}

type Counted = { readonly review: DecisiveReview; readonly external: boolean };

function latestDecisive(
  facts: PullRequestFacts,
  heads: ReadonlySet<string>,
  external: readonly string[],
): Map<string, Counted> {
  const latest = new Map<string, Counted>();
  for (const review of facts.reviews) {
    const counted = countedReviewer(review.reviewer, external);
    const onHead = heads.has(fullSha(review.commit) ?? '');
    if (counted === null || !onHead || !isDecisive(review)) continue;
    const seen = latest.get(counted.reviewer);
    if (seen === undefined || reviewedLater(review, seen.review)) {
      latest.set(counted.reviewer, { review, external: counted.external });
    }
  }
  return latest;
}

function providerOf({ review, external }: Counted): string | null {
  if (external) return EXTERNAL_PROVIDER;
  return review.provider === null ? null : normalisedIdentifier(review.provider);
}

function approvalsOn(
  facts: PullRequestFacts,
  heads: ReadonlySet<string>,
  external: readonly string[],
): ShipRuleInput['approvals'] {
  return [...latestDecisive(facts, heads, external).entries()]
    .filter(([, counted]) => counted.review.state === 'approved')
    .map(([reviewer, counted]) => ({
      reviewer,
      commit: fullSha(counted.review.commit) ?? counted.review.commit,
      provider: providerOf(counted),
    }));
}

function headsCarrying(facts: PullRequestFacts, head: string): ReadonlySet<string> {
  const compared = comparisonAt(facts, head);
  return new Set([head, ...(compared === null ? [] : carriedCommits(compared, head))]);
}

export function reviewsOn(
  facts: PullRequestFacts,
  head: string,
  external: readonly string[],
): GateView['reviews'] {
  return [...latestDecisive(facts, headsCarrying(facts, head), external).entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([reviewer, counted]) => ({
      reviewer,
      commit: fullSha(counted.review.commit) ?? counted.review.commit,
      state: counted.review.state,
      provider: providerOf(counted),
      findings: [...counted.review.findings],
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

function comparisonAt(facts: PullRequestFacts, head: string): BaseComparison | null {
  const compared = facts.comparison;
  if (compared === null || compared.head !== head) return null;
  return compared.base === fullSha(facts.base) ? compared : null;
}

function skipCiOf(compared: BaseComparison | null): boolean | null {
  if (compared === null || compared.commits === null) return null;
  return compared.commits.some((commit) => commit.skipCi);
}

function sameRef(left: ClosingRef, right: ClosingRef): boolean {
  return left.number === right.number && left.repo.toLowerCase() === right.repo.toLowerCase();
}

function closesOf(facts: PullRequestFacts, compared: BaseComparison | null): ClosingRef[] | null {
  if (facts.closes === null || compared === null || compared.commits === null) return null;
  const fromCommits = compared.commits.flatMap((commit) => commit.closes);
  const all = [...facts.closes, ...fromCommits];
  return all
    .filter((ref, index) => all.findIndex((other) => sameRef(ref, other)) === index)
    .slice(0, CLOSES_LIMIT);
}

type FromFacts = Pick<
  ShipRuleInput,
  'pullRequest' | 'carries' | 'checks' | 'approvals' | 'closes' | 'riskTier' | 'riskDomains'
>;

function fromUsableHead(source: ShipInputSource, facts: PullRequestFacts, head: string): FromFacts {
  const compared = comparisonAt(facts, head);
  const carries = compared === null ? [] : [...carriedCommits(compared, head)];
  const external = source.harness.externalReviewerIdentities;
  return {
    pullRequest: {
      open: facts.state === 'open',
      draft: facts.draft,
      head,
      behindBy: compared?.behindBy ?? null,
      skipCi: skipCiOf(compared),
    },
    carries,
    checks: latestChecks(facts, head),
    approvals: approvalsOn(facts, new Set([head, ...carries]), external),
    closes: closesOf(facts, compared),
    ...riskAtHead(facts, source, head),
  };
}

function fromFacts(source: ShipInputSource): FromFacts {
  const { facts, item } = source;
  const head = usableHead(facts, item, source.harness);
  if (facts === null || head === null) {
    return {
      pullRequest: null,
      carries: [],
      checks: [],
      approvals: [],
      closes: [],
      riskTier: null,
      riskDomains: [...item.riskDomains],
    };
  }
  return fromUsableHead(source, facts, head);
}

export function assembleShipInput(source: ShipInputSource): ShipRuleInput {
  const { item, harness } = source;
  return {
    ...fromFacts(source),
    expectedHead: item.expectedHead === null ? null : fullSha(item.expectedHead),
    requiredChecks: [...harness.requiredChecks],
    wraps: item.issue === null ? null : { repo: item.issue.repo, number: item.issue.number },
    area: harness.jdArea,
    approver: source.approver,
    at: source.at.toISOString(),
    frozen: harness.frozen && !harness.freezeAllow.includes(item.itemId),
    delegation: null,
    override: source.override,
  };
}

export function riskDerivedAtShip(source: ShipInputSource): RiskDerived | null {
  const { facts, item } = source;
  const head = usableHead(facts, item, source.harness);
  return facts === null || head === null ? null : derivedAt(facts, source, head);
}
