import {
  shipRefusalSchema,
  type ClosingRef,
  type RequiredCheck,
  type ShipRefusal,
  type ShipRuleInput,
  type ShipRuleOutcome,
} from '@uw/contracts';
import { normalisedIdentifier } from './github/identifiers.ts';
import { approverCovers } from './risk/domain-grants.ts';

type Predicate = (input: ShipRuleInput) => boolean;
type Check = ShipRuleInput['checks'][number];

export type CountedApproval = {
  readonly reviewer: string;
  readonly commit: string;
  readonly head: string;
};

function headOf(input: ShipRuleInput): string | null {
  return input.pullRequest === null ? null : input.pullRequest.head;
}

function countsOnHead(input: ShipRuleInput, commit: string): boolean {
  const head = headOf(input);
  return head !== null && (commit === head || input.carries.includes(commit));
}

function approvalsOnHead(input: ShipRuleInput): ShipRuleInput['approvals'] {
  return input.approvals.filter((approval) => countsOnHead(input, approval.commit));
}

function providersByReviewer(input: ShipRuleInput): ReadonlyMap<string, ReadonlySet<string>> {
  const byReviewer = new Map<string, Set<string>>();
  for (const approval of approvalsOnHead(input)) {
    const reviewer = normalisedIdentifier(approval.reviewer);
    if (reviewer === null) continue;
    const providers = byReviewer.get(reviewer) ?? new Set<string>();
    const provider = approval.provider === null ? null : normalisedIdentifier(approval.provider);
    if (provider !== null) providers.add(provider);
    byReviewer.set(reviewer, providers);
  }
  return byReviewer;
}

function reviewersOnHead(input: ShipRuleInput): number {
  return providersByReviewer(input).size;
}

function resolvedProviders(input: ShipRuleInput): ReadonlySet<string> {
  const resolved = new Set<string>();
  for (const providers of providersByReviewer(input).values()) {
    const [only] = providers;
    if (providers.size === 1 && only !== undefined) resolved.add(only);
  }
  return resolved;
}

function pullRequestNotOpen(input: ShipRuleInput): boolean {
  return input.pullRequest === null || !input.pullRequest.open;
}

function pullRequestIsDraft(input: ShipRuleInput): boolean {
  return input.pullRequest !== null && input.pullRequest.draft;
}

function headMismatch(input: ShipRuleInput): boolean {
  return input.expectedHead === null || !countsOnHead(input, input.expectedHead);
}

function checksOnHead(input: ShipRuleInput, head: string): readonly Check[] {
  return input.checks.filter((check) => check.headSha === head);
}

function isRequired(check: Check, required: RequiredCheck): boolean {
  return check.name === required.name && check.app === required.app;
}

function checksNotGreen(input: ShipRuleInput): boolean {
  const head = headOf(input);
  if (head === null) return true;
  const onHead = checksOnHead(input, head);
  if (input.requiredChecks.length === 0) {
    return onHead.length === 0 || onHead.some((check) => check.conclusion !== 'success');
  }
  return input.requiredChecks.some((required) =>
    onHead.some((check) => isRequired(check, required) && check.conclusion !== 'success'),
  );
}

function requiredCheckNeverRan(input: ShipRuleInput): boolean {
  const head = headOf(input);
  if (head === null) return false;
  const onHead = checksOnHead(input, head);
  return input.requiredChecks.some(
    (required) => !onHead.some((check) => isRequired(check, required)),
  );
}

function baseBehind(input: ShipRuleInput): boolean {
  const { pullRequest } = input;
  return pullRequest !== null && (pullRequest.behindBy === null || pullRequest.behindBy > 0);
}

function skipCiMarker(input: ShipRuleInput): boolean {
  return input.pullRequest !== null && input.pullRequest.skipCi !== false;
}

function sameIssue(left: ClosingRef, right: ClosingRef | null): boolean {
  return (
    right !== null &&
    left.number === right.number &&
    left.repo.toLowerCase() === right.repo.toLowerCase()
  );
}

function autoCloseKeyword(input: ShipRuleInput): boolean {
  const { closes } = input;
  if (input.pullRequest === null) return false;
  return closes === null || closes.some((ref) => !sameIssue(ref, input.wraps));
}

function harnessFrozen(input: ShipRuleInput): boolean {
  return input.frozen;
}

function noReviewerApproval(input: ShipRuleInput): boolean {
  return !input.override && reviewersOnHead(input) === 0;
}

function riskTierUndeclared(input: ShipRuleInput): boolean {
  return input.riskTier === null;
}

function reviewerCountBelowTier(input: ShipRuleInput): boolean {
  return input.riskTier === 'high' && reviewersOnHead(input) < 2;
}

function reviewerProvidersNotDistinct(input: ShipRuleInput): boolean {
  return (
    input.riskTier === 'high' && reviewersOnHead(input) >= 2 && resolvedProviders(input).size < 2
  );
}

function approverLacksDomainGrant(input: ShipRuleInput): boolean {
  return !approverCovers(input.approver, input.area, input.riskDomains, new Date(input.at));
}

const failing: ReadonlyMap<ShipRefusal, Predicate> = new Map<ShipRefusal, Predicate>([
  ['pr_not_open', pullRequestNotOpen],
  ['pr_is_draft', pullRequestIsDraft],
  ['head_mismatch', headMismatch],
  ['checks_not_green', checksNotGreen],
  ['no_reviewer_approval', noReviewerApproval],
  ['risk_tier_undeclared', riskTierUndeclared],
  ['reviewer_count_below_tier', reviewerCountBelowTier],
  ['reviewer_providers_not_distinct', reviewerProvidersNotDistinct],
  ['approver_lacks_domain_grant', approverLacksDomainGrant],
  ['base_behind', baseBehind],
  ['auto_close_keyword', autoCloseKeyword],
  ['skip_ci_marker', skipCiMarker],
  ['required_check_never_ran', requiredCheckNeverRan],
  ['harness_frozen', harnessFrozen],
]);

function fails(input: ShipRuleInput): (reason: ShipRefusal) => boolean {
  return (reason) => failing.get(reason)?.(input) ?? true;
}

export function shipRule(input: ShipRuleInput): ShipRuleOutcome {
  const reasons = shipRefusalSchema.options.filter(fails(input));
  return reasons.length === 0 ? { verdict: 'advance' } : { verdict: 'refuse', reasons };
}

export function countedApprovals(input: ShipRuleInput): readonly CountedApproval[] {
  const head = headOf(input);
  if (head === null) return [];
  return approvalsOnHead(input).map(({ reviewer, commit }) => ({ reviewer, commit, head }));
}
