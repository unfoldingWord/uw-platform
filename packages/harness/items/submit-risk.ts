import type { EventEvidence, ItemState } from '@uw/contracts';
import { pathsComparedAt } from '../github/changed-files.ts';
import { riskDeclarationOf } from '../github/declaration.ts';
import { branchFor, fullSha, sameRepository } from '../github/identifiers.ts';
import type { PullRequestFacts, PullRequestRef } from '../ports.ts';
import { applyDeclaration, carryForward, floorFromPaths } from '../risk/derive.ts';
import { draft, type EventDraft } from './record.ts';

type SubmitChange = { readonly pullRequest: PullRequestRef; readonly head: string };

function samePullRequest(facts: PullRequestFacts, change: SubmitChange): boolean {
  const { repo, number } = change.pullRequest;
  return sameRepository(facts.ref.repo, repo) && facts.ref.number === number;
}

function pathsAtHead(
  facts: PullRequestFacts | null,
  change: SubmitChange,
  item: ItemState,
): readonly string[] | null {
  if (facts === null || !samePullRequest(facts, change)) return null;
  if (facts.headRepo === null || !sameRepository(facts.headRepo, change.pullRequest.repo)) {
    return null;
  }
  if (facts.headRef !== branchFor(item.itemId) || fullSha(facts.head) !== change.head) return null;
  return pathsComparedAt(facts, change.head);
}

function baseOf(facts: PullRequestFacts): EventEvidence['risk_derived']['base'] {
  const sha = fullSha(facts.base);
  return sha === null ? null : { sha, ref: facts.baseRef };
}

export function riskDraft(
  facts: PullRequestFacts | null,
  change: SubmitChange | null,
  item: ItemState,
): readonly EventDraft[] {
  if (change === null || facts === null) return [];
  const paths = pathsAtHead(facts, change, item);
  if (paths === null) return [];
  const fresh = floorFromPaths(paths);
  const floor = carryForward(fresh, { tier: item.riskTier, domains: item.riskDomains });
  const declaration = riskDeclarationOf(facts.declaration);
  const result = applyDeclaration(floor, declaration);
  return [
    draft('risk_derived', {
      paths: [...paths],
      declaration,
      floorDomains: [...floor.domains],
      riskTier: result.ok ? result.tier : floor.tier,
      riskDomains: [...result.domains],
      refusal: result.ok ? null : result.reason,
      head: change.head,
      repository: change.pullRequest.repo,
      base: baseOf(facts),
    }),
  ];
}
