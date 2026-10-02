import {
  ciJobSchema,
  shipRefusalSchema,
  type ShipRefusal,
  type ShipRuleInput,
  type ShipRuleOutcome,
} from '@uw/contracts';
import { approverCovers } from './risk/domain-grants.ts';

type Predicate = (input: ShipRuleInput) => boolean;

function headOf(input: ShipRuleInput): string | null {
  return input.pullRequest === null ? null : input.pullRequest.head;
}

function approvalsOnHead(input: ShipRuleInput): ShipRuleInput['approvals'] {
  const head = headOf(input);
  return head === null ? [] : input.approvals.filter((approval) => approval.commit === head);
}

function reviewersOnHead(input: ShipRuleInput): ReadonlySet<string> {
  return new Set(approvalsOnHead(input).map((approval) => approval.reviewer));
}

function providersOnHead(input: ShipRuleInput): ReadonlySet<string> {
  const providers = new Set<string>();
  for (const approval of approvalsOnHead(input)) {
    if (approval.provider !== null) providers.add(approval.provider);
  }
  return providers;
}

function pullRequestNotOpen(input: ShipRuleInput): boolean {
  return input.pullRequest === null || !input.pullRequest.open;
}

function pullRequestIsDraft(input: ShipRuleInput): boolean {
  return input.pullRequest !== null && input.pullRequest.draft;
}

function headMismatch(input: ShipRuleInput): boolean {
  const head = headOf(input);
  return head === null || input.expectedHead === null || head !== input.expectedHead;
}

function jobIsGreen(input: ShipRuleInput, head: string, job: string): boolean {
  const runs = input.checks.filter((check) => check.name === job && check.headSha === head);
  return runs.length > 0 && runs.every((check) => check.conclusion === 'success');
}

function checksNotGreen(input: ShipRuleInput): boolean {
  const head = headOf(input);
  if (head === null) return true;
  return !ciJobSchema.options.every((job) => jobIsGreen(input, head, job));
}

function noReviewerApproval(input: ShipRuleInput): boolean {
  return !input.override && reviewersOnHead(input).size === 0;
}

function riskTierUndeclared(input: ShipRuleInput): boolean {
  return input.riskTier === null;
}

function reviewerCountBelowTier(input: ShipRuleInput): boolean {
  return input.riskTier === 'high' && reviewersOnHead(input).size < 2;
}

function reviewerProvidersNotDistinct(input: ShipRuleInput): boolean {
  return (
    input.riskTier === 'high' && reviewersOnHead(input).size >= 2 && providersOnHead(input).size < 2
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
]);

function fails(input: ShipRuleInput): (reason: ShipRefusal) => boolean {
  return (reason) => failing.get(reason)?.(input) ?? true;
}

export function shipRule(input: ShipRuleInput): ShipRuleOutcome {
  const reasons = shipRefusalSchema.options.filter(fails(input));
  return reasons.length === 0 ? { verdict: 'advance' } : { verdict: 'refuse', reasons };
}
