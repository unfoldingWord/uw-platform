import {
  delegationIdOf,
  type Grant,
  type Harness,
  type ItemState,
  type Principal,
  type Stage,
} from '@uw/contracts';
import { allowed, ownerBound } from '../access.ts';
import type { Caller } from '../caller.ts';
import { personaMatches } from '../delegations/beat.ts';
import { assertDelegationLive } from '../delegations/live.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';

export type ScenePorts = Pick<Ports, 'grants'>;
export type HarnessScene = { readonly harness: Harness; readonly stages: readonly Stage[] };
export type ItemScene = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stage: Stage;
};
type LiveDelegation = { readonly delegation: Delegation; readonly grants: readonly Grant[] };

export async function presentedDelegation(
  ports: ScenePorts,
  tx: StoreTransaction,
  actor: Principal,
  delegationId: string,
  at: Date,
): Promise<KernelOutcome<LiveDelegation>> {
  const found = await tx.delegations.read.byId(delegationId);
  if (found === null || found.personId !== actor.personId) {
    return refused('delegation_not_found', { delegationId });
  }
  if (!personaMatches(actor.identity, found)) return refused('not_permitted', { delegationId });
  const liveness = await assertDelegationLive(tx, ports, delegationId, at);
  if (!liveness.live) return refused('delegation_lapsed', { delegationId, why: liveness.why });
  return accepted({ delegation: liveness.delegation, grants: liveness.grants });
}

async function delegationAdmits(
  ports: ScenePorts,
  tx: StoreTransaction,
  actor: Principal,
  harness: Harness,
  at: Date,
): Promise<boolean> {
  const delegationId = delegationIdOf(actor.identity);
  if (delegationId === null) return true;
  const presented = await presentedDelegation(ports, tx, actor, delegationId, at);
  return presented.status === 'accepted' && presented.value.delegation.harnessId === harness.id;
}

async function readableHarness(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<Harness | null> {
  if (!ownerBound(caller.actor)) return null;
  const harness = await tx.harnesses.read.byId(harnessId);
  if (harness === null || !allowed(caller.actor, 'read', harness, at)) return null;
  return (await delegationAdmits(ports, tx, caller.actor, harness, at)) ? harness : null;
}

export async function harnessScene(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  harnessId: string,
  at: Date,
): Promise<KernelOutcome<HarnessScene>> {
  const harness = await readableHarness(ports, tx, caller, harnessId, at);
  if (harness === null) return refused('harness_not_found', { harnessId });
  return accepted({ harness, stages: await tx.harnessStages.read.forHarness(harness.id) });
}

export async function itemScene(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  itemId: string,
  at: Date,
): Promise<KernelOutcome<ItemScene>> {
  const item = await tx.harnessItems.read.byId(itemId);
  const harness =
    item === null ? null : await readableHarness(ports, tx, caller, item.harnessId, at);
  if (item === null || harness === null) return refused('item_not_found', { itemId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((candidate) => candidate.key === item.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stageKey: item.stageKey });
  return accepted({ item, harness, stage });
}

export function byPriorityThenId(
  a: Pick<ItemState, 'itemId' | 'priority'>,
  b: Pick<ItemState, 'itemId' | 'priority'>,
): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.itemId === b.itemId) return 0;
  return a.itemId < b.itemId ? -1 : 1;
}

export async function itemsInStage(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: { readonly harnessId: string; readonly stageKey: string },
  at: Date,
): Promise<KernelOutcome<readonly ItemState[]>> {
  const scene = await harnessScene(ports, tx, caller, input.harnessId, at);
  if (scene.status !== 'accepted') return scene;
  if (!scene.value.stages.some((stage) => stage.key === input.stageKey)) {
    return refused('stage_not_found', { stageKey: input.stageKey });
  }
  const items = await tx.harnessItems.read.forHarness(input.harnessId);
  return accepted(items.filter((item) => item.stageKey === input.stageKey).sort(byPriorityThenId));
}
