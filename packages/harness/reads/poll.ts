import {
  delegationIdOf,
  type Grant,
  type Harness,
  type ItemState,
  type Principal,
  type Stage,
} from '@uw/contracts';
import { allowed, bareAgent, isAgent, ownerBound } from '../access.ts';
import { beatPrincipal } from '../delegations/beat.ts';
import { leaseLapsed } from '../items/leases.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Delegation, StoreTransaction } from '../ports.ts';
import {
  byPriorityThenId,
  presentedDelegation,
  workingDelegations,
  type ScenePorts,
} from './scene.ts';

export type PollItem = {
  readonly itemId: string;
  readonly harnessId: string;
  readonly stage: string;
  readonly title: string;
  readonly priority: number;
};

export type PollInput = { readonly harnessId: string | null; readonly limit: number };

type Form = 'delegated' | 'persona' | 'other';
type Judged = { readonly harness: Harness; readonly principal: Principal };
type Subscription = (
  ports: ScenePorts,
  tx: StoreTransaction,
  actor: Principal,
  at: Date,
) => Promise<readonly Judged[] | Refused>;

async function judgedBy(
  tx: StoreTransaction,
  delegation: Delegation,
  grants: readonly Grant[],
  at: Date,
): Promise<Judged | null> {
  const harness = await tx.harnesses.read.byId(delegation.harnessId);
  if (harness === null) return null;
  return { harness, principal: beatPrincipal(delegation, grants, harness.jdArea, at) };
}

const delegated: Subscription = async (ports, tx, actor, at) => {
  const delegationId = delegationIdOf(actor.identity) ?? '';
  const presented = await presentedDelegation(ports, tx, actor, delegationId, at);
  if (presented.status !== 'accepted') return presented;
  const judged = await judgedBy(tx, presented.value.delegation, presented.value.grants, at);
  return judged === null ? [] : [judged];
};

const persona: Subscription = async (ports, tx, actor, at) => {
  const judged = new Map<string, Judged>();
  for (const { delegation, grants } of await workingDelegations(ports, tx, actor, null, at)) {
    if (judged.has(delegation.harnessId)) continue;
    const found = await judgedBy(tx, delegation, grants, at);
    if (found !== null) judged.set(found.harness.id, found);
  }
  return [...judged.values()];
};

const other: Subscription = async (ports, tx, actor, at) => {
  if (isAgent(actor) && !actor.interactive) return [];
  const grants =
    actor.personId === null ? [] : await ports.grants.resolveIn(tx, actor.personId, at);
  const principal = { ...actor, grants: [...grants] };
  const harnesses = await tx.harnesses.read.list();
  return harnesses.map((harness) => ({ harness, principal }));
};

const subscriptions: ReadonlyMap<Form, Subscription> = new Map<Form, Subscription>([
  ['delegated', delegated],
  ['persona', persona],
  ['other', other],
]);

function formOf(actor: Principal): Form {
  if (delegationIdOf(actor.identity) !== null) return 'delegated';
  return bareAgent(actor.identity) ? 'persona' : 'other';
}

function claimable(stages: readonly Stage[], item: ItemState, at: Date): boolean {
  const stage = stages.find((candidate) => candidate.key === item.stageKey);
  if (stage === undefined || stage.paused || stage.agentPickup === 'none') return false;
  const open = item.gateStatus === 'working' || item.gateStatus === 'checks_failed';
  return open && (item.holder === null || leaseLapsed(item, at));
}

async function claimableIn(
  tx: StoreTransaction,
  harness: Harness,
  at: Date,
): Promise<readonly ItemState[]> {
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const items = await tx.harnessItems.read.forHarness(harness.id);
  return items.filter((item) => claimable(stages, item, at));
}

function polledItem(item: ItemState): PollItem {
  return {
    itemId: item.itemId,
    harnessId: item.harnessId,
    stage: item.stageKey,
    title: item.title,
    priority: item.priority,
  };
}

function workable(input: PollInput, at: Date) {
  return ({ harness, principal }: Judged): boolean =>
    (input.harnessId === null || harness.id === input.harnessId) &&
    !harness.paused &&
    allowed(principal, 'read', harness, at) &&
    allowed(principal, 'write', harness, at);
}

export async function pollQueue(
  ports: ScenePorts,
  tx: StoreTransaction,
  actor: Principal,
  input: PollInput,
  at: Date,
): Promise<KernelOutcome<readonly PollItem[]>> {
  if (!ownerBound(actor)) return refused('not_permitted', { why: 'owner_mismatch' });
  const subscribe = subscriptions.get(formOf(actor)) ?? other;
  const subscribed = await subscribe(ports, tx, actor, at);
  if ('status' in subscribed) return subscribed;
  const items: ItemState[] = [];
  for (const { harness } of subscribed.filter(workable(input, at))) {
    items.push(...(await claimableIn(tx, harness, at)));
  }
  return accepted(items.sort(byPriorityThenId).slice(0, input.limit).map(polledItem));
}
