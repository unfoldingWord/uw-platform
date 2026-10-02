import type { Harness, ItemState } from '@uw/contracts';
import { factsFailure } from '../gates/facts-failure.ts';
import { isStale, staleRefusal } from '../gates/facts-fresh.ts';
import { branchFor, fullSha, sameRepository } from '../github/identifiers.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports, PullRequestFacts, PullRequestRef } from '../ports.ts';
import { lapseDrafts } from './leases.ts';

type TipPorts = Pick<Ports, 'githubFacts' | 'store'>;

export type ClaimedBranch = {
  readonly name: string;
  readonly startFrom: string | null;
  readonly adopted: boolean;
};

export type BranchTip = { readonly facts: PullRequestFacts | null } | { readonly refusal: Refused };

type Adoption = { readonly head: string | null };

function harnessPullRequest(ports: TipPorts, itemId: string): Promise<PullRequestRef | null> {
  return ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.byId(itemId);
    const ref = item?.pullRequest ?? null;
    if (item === null || ref === null) return null;
    const harness = await tx.harnesses.read.byId(item.harnessId);
    return sameRepository(ref.repo, harness?.repository ?? null) ? ref : null;
  });
}

export async function readBranchTip(ports: TipPorts, itemId: string): Promise<BranchTip> {
  const ref = await harnessPullRequest(ports, itemId);
  if (ref === null) return { facts: null };
  try {
    return { facts: await ports.githubFacts.pullRequest(ref) };
  } catch (error) {
    return { refusal: factsFailure(error) };
  }
}

const notAdoptable = refused('not_permitted', { adoptBranch: true, why: 'branch_not_adoptable' });

function tipOf(item: ItemState, ref: PullRequestRef, facts: PullRequestFacts): string | null {
  if (!sameRepository(facts.ref.repo, ref.repo) || facts.ref.number !== ref.number) return null;
  if (facts.state !== 'open' || facts.headRef !== branchFor(item.itemId)) return null;
  return fullSha(facts.head);
}

function adoptedTip(
  item: ItemState,
  harness: Harness,
  tip: BranchTip,
  at: Date,
): Adoption | Refused {
  if ('refusal' in tip) return tip.refusal;
  const ref = item.pullRequest;
  if (ref === null || !sameRepository(ref.repo, harness.repository)) return notAdoptable;
  if (tip.facts === null || isStale(tip.facts, at)) return staleRefusal(tip.facts);
  const head = tipOf(item, ref, tip.facts);
  return head === null ? notAdoptable : { head };
}

function abandonedBy(item: ItemState, at: Date): boolean {
  if (item.branchState === 'abandoned') return true;
  return lapseDrafts(item, at).some((entry) => entry.name === 'branch_abandoned');
}

export function adoptionOf(
  item: ItemState,
  harness: Harness,
  tip: BranchTip | null,
  at: Date,
): Adoption | Refused {
  if (tip === null) return { head: null };
  if (!abandonedBy(item, at)) {
    return refused('malformed_command', { adoptBranch: true, why: 'no_abandoned_branch' });
  }
  return adoptedTip(item, harness, tip, at);
}

export function claimedBranch(item: ItemState, adoption: Adoption): ClaimedBranch {
  return {
    name: branchFor(item.itemId),
    startFrom: adoption.head ?? item.expectedHead,
    adopted: adoption.head !== null,
  };
}
