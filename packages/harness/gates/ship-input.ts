import type { ItemState, JdArea, Principal, ShipRuleInput } from '@uw/contracts';
import type { PullRequestFacts, PullRequestRef } from '../ports.ts';

type ShipInputSource = {
  readonly facts: PullRequestFacts | null;
  readonly item: ItemState;
  readonly area: JdArea;
  readonly approver: Principal;
  readonly at: Date;
  readonly override: boolean;
};

function normalisedSha(sha: string): string {
  return sha.trim().toLowerCase();
}

function sameRef(a: PullRequestRef, b: PullRequestRef | null): boolean {
  return b !== null && a.number === b.number && a.repo.toLowerCase() === b.repo.toLowerCase();
}

function onHead(
  facts: PullRequestFacts,
  head: string,
): Pick<ShipRuleInput, 'checks' | 'approvals'> {
  return {
    checks: facts.checks
      .filter((check) => normalisedSha(check.headSha) === head)
      .map((check) => ({ name: check.name, headSha: head, conclusion: check.conclusion })),
    approvals: facts.reviews
      .filter((review) => review.state === 'approved' && normalisedSha(review.commit) === head)
      .map((review) => ({ reviewer: review.reviewer, commit: head, provider: review.provider })),
  };
}

function fromFacts(
  facts: PullRequestFacts | null,
  item: ItemState,
): Pick<ShipRuleInput, 'pullRequest' | 'checks' | 'approvals'> {
  if (facts === null || !sameRef(facts.ref, item.pullRequest)) {
    return { pullRequest: null, checks: [], approvals: [] };
  }
  const head = normalisedSha(facts.head);
  return {
    pullRequest: { open: facts.state === 'open', draft: facts.draft, head },
    ...onHead(facts, head),
  };
}

export function assembleShipInput(input: ShipInputSource): ShipRuleInput {
  const { item } = input;
  return {
    ...fromFacts(input.facts, item),
    expectedHead: item.expectedHead === null ? null : normalisedSha(item.expectedHead),
    riskTier: item.riskTier,
    riskDomains: [...item.riskDomains],
    area: input.area,
    approver: input.approver,
    at: input.at.toISOString(),
    override: input.override,
  };
}
