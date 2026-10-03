import type { Harness, ItemState } from '@uw/contracts';
import { factsFailure } from '../gates/facts-failure.ts';
import { staleRefusal } from '../gates/facts-fresh.ts';
import { branchFor, fullSha, sameRepository } from '../github/identifiers.ts';
import { refused, type Refused } from '../outcome.ts';
import type { Ports, PullRequestFacts, PullRequestRef, StoreTransaction } from '../ports.ts';
import { leaseLapsed } from './leases.ts';
import { readAllEvents } from './record.ts';

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
  if (facts.headRepo === null || !sameRepository(facts.headRepo, ref.repo)) return null;
  if (facts.state !== 'open' || facts.headRef !== branchFor(item.itemId)) return null;
  return fullSha(facts.head);
}

function reportedAfter(facts: PullRequestFacts, abandoned: Date): boolean {
  return facts.freshAt.getTime() > abandoned.getTime();
}

function adoptedTip(
  item: ItemState,
  harness: Harness,
  tip: BranchTip,
  abandoned: Date,
): Adoption | Refused {
  if ('refusal' in tip) return tip.refusal;
  const ref = item.pullRequest;
  if (ref === null || !sameRepository(ref.repo, harness.repository)) return notAdoptable;
  if (tip.facts === null || !reportedAfter(tip.facts, abandoned)) return staleRefusal(tip.facts);
  const head = tipOf(item, ref, tip.facts);
  return head === null ? notAdoptable : { head };
}

async function abandonedAt(tx: StoreTransaction, item: ItemState, at: Date): Promise<Date | null> {
  if (leaseLapsed(item, at) && item.branchState === 'active') {
    return new Date(item.leaseExpiresAt);
  }
  if (item.branchState !== 'abandoned') return null;
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  const abandoned = events.findLast((event) => event.name === 'branch_abandoned');
  return abandoned === undefined ? null : new Date(abandoned.at);
}

export async function adoptionOf(
  tx: StoreTransaction,
  scene: { readonly item: ItemState; readonly harness: Harness },
  tip: BranchTip | null,
  at: Date,
): Promise<Adoption | Refused> {
  if (tip === null) return { head: null };
  const abandoned = await abandonedAt(tx, scene.item, at);
  if (abandoned === null) {
    return refused('malformed_command', { adoptBranch: true, why: 'no_abandoned_branch' });
  }
  return adoptedTip(scene.item, scene.harness, tip, abandoned);
}

export function claimedBranch(item: ItemState, adoption: Adoption): ClaimedBranch {
  return {
    name: branchFor(item.itemId),
    startFrom: adoption.head ?? item.expectedHead,
    adopted: adoption.head !== null,
  };
}
