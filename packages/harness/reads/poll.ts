import {
  delegationIdOf,
  type Harness,
  type ItemState,
  type Principal,
  type Stage,
} from '@uw/contracts';
import { allowed, bareAgent, ownerBound } from '../access.ts';
import { personaMatches } from '../delegations/beat.ts';
import { assertDelegationLive } from '../delegations/live.ts';
import { leaseLapsed } from '../items/leases.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { byPriorityThenId } from './scene.ts';

export type PollItem = {
  readonly itemId: string;
  readonly harnessId: string;
  readonly stage: string;
  readonly title: string;
  readonly priority: number;
};

export type PollInput = { readonly harnessId: string | null; readonly limit: number };

type PollPorts = Pick<Ports, 'grants'>;
type Form = 'delegated' | 'persona' | 'other';
type Subscription = (
  ports: PollPorts,
  tx: StoreTransaction,
  actor: Principal,
  at: Date,
) => Promise<readonly Harness[] | Refused>;

async function harnessesById(
  tx: StoreTransaction,
  harnessIds: readonly string[],
): Promise<readonly Harness[]> {
  const found: Harness[] = [];
  for (const harnessId of new Set(harnessIds)) {
    const harness = await tx.harnesses.read.byId(harnessId);
    if (harness !== null) found.push(harness);
  }
  return found;
}

const delegated: Subscription = async (ports, tx, actor, at) => {
  const delegationId = delegationIdOf(actor.identity) ?? '';
  const found = await tx.delegations.read.byId(delegationId);
  if (found === null || found.personId !== actor.personId) {
    return refused('delegation_not_found', { delegationId });
  }
  if (!personaMatches(actor.identity, found)) return refused('not_permitted', { delegationId });
  const liveness = await assertDelegationLive(tx, ports, delegationId, at);
  if (!liveness.live) return refused('delegation_lapsed', { delegationId, why: liveness.why });
  return harnessesById(tx, [liveness.delegation.harnessId]);
};

const persona: Subscription = async (_ports, tx, actor, at) => {
  if (actor.personId === null) return [];
  const live = await tx.delegations.read.live(
    { personId: actor.personId, persona: actor.identity, harnessId: null },
    at,
  );
  return harnessesById(
    tx,
    live.map((delegation) => delegation.harnessId),
  );
};

const other: Subscription = (_ports, tx) => tx.harnesses.read.list();

const subscriptions: ReadonlyMap<Form, Subscription> = new Map<Form, Subscription>([
  ['delegated', delegated],
  ['persona', persona],
  ['other', other],
]);

function formOf(actor: Principal): Form {
  if (delegationIdOf(actor.identity) !== null) return 'delegated';
  return bareAgent(actor.identity) ? 'persona' : 'other';
}

async function freshActor(
  ports: PollPorts,
  tx: StoreTransaction,
  actor: Principal,
  at: Date,
): Promise<Principal> {
  if (actor.personId === null) return { ...actor, grants: [] };
  return { ...actor, grants: [...(await ports.grants.resolveIn(tx, actor.personId, at))] };
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

function workable(fresh: Principal, input: PollInput, at: Date) {
  return (harness: Harness): boolean =>
    (input.harnessId === null || harness.id === input.harnessId) &&
    !harness.paused &&
    allowed(fresh, 'read', harness, at) &&
    allowed(fresh, 'write', harness, at);
}

export async function pollQueue(
  ports: PollPorts,
  tx: StoreTransaction,
  actor: Principal,
  input: PollInput,
  at: Date,
): Promise<KernelOutcome<readonly PollItem[]>> {
  if (!ownerBound(actor)) return refused('not_permitted', { why: 'owner_mismatch' });
  const subscribe = subscriptions.get(formOf(actor)) ?? other;
  const subscribed = await subscribe(ports, tx, actor, at);
  if ('status' in subscribed) return subscribed;
  const fresh = await freshActor(ports, tx, actor, at);
  const items: ItemState[] = [];
  for (const harness of subscribed.filter(workable(fresh, input, at))) {
    items.push(...(await claimableIn(tx, harness, at)));
  }
  return accepted(items.sort(byPriorityThenId).slice(0, input.limit).map(polledItem));
}
