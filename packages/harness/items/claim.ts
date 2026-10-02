import type { Harness, ItemState, Stage } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { beatPrincipal, personaMatches } from '../delegations/beat.ts';
import { assertDelegationLive, recordLapse } from '../delegations/live.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';
import { lapseDrafts, LEASE_MS, leaseLapsed } from './leases.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from './record.ts';

type ClaimPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

export type Claimed = {
  readonly item: ItemState;
  readonly leaseExpiresAt: string | null;
  readonly leaseWarning: boolean;
};

export type ClaimInput = { readonly itemId: string; readonly delegationId: string | null };

type Scene = {
  readonly caller: Caller;
  readonly harness: Harness;
  readonly stage: Stage;
  readonly context: RecordContext;
};

function gateRefusal(item: ItemState): Refused | null {
  if (item.gateStatus === 'parked') return refused('not_permitted', { why: 'parked' });
  if (item.gateStatus === 'done') return refused('not_permitted', { why: 'done' });
  return null;
}

function claimGuards(scene: Scene, item: ItemState): Refused | null {
  const { caller, harness, stage, context } = scene;
  if (!allowed(caller.actor, 'write', harness, context.at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  const gated = gateRefusal(item);
  if (gated !== null) return gated;
  if (caller.actor.kind === 'agent' && stage.agentPickup === 'none') {
    return refused('pickup_not_allowed', { stage: stage.key });
  }
  return null;
}

function lockedGuards(scene: Scene, item: ItemState): Refused | null {
  if (item.stageKey !== scene.stage.key) return refused('not_permitted', { why: 'moved' });
  return gateRefusal(item);
}

function bindingRefusal(scene: Scene, item: ItemState, delegation: Delegation): Refused | null {
  const { caller, context } = scene;
  const bound =
    delegation.personId === caller.actor.personId &&
    delegation.harnessId === item.harnessId &&
    personaMatches(context.actor, delegation);
  return bound ? null : refused('not_permitted', { delegationId: delegation.id });
}

async function delegationGuard(
  tx: StoreTransaction,
  ports: ClaimPorts,
  scene: Scene,
  item: ItemState,
  delegationId: string | null,
): Promise<Refused | null> {
  const { caller, harness, stage, context } = scene;
  if (delegationId === null) {
    if (caller.actor.interactive) return null;
    await recordItemEvents(tx, context, item.itemId, [
      draft('delegation_required', { stage: stage.key }),
    ]);
    return refused('delegation_required', { stage: stage.key });
  }
  const liveness = await assertDelegationLive(tx, ports, delegationId, context.at);
  if (liveness.delegation === null) return refused('delegation_not_found', { delegationId });
  const unbound = bindingRefusal(scene, item, liveness.delegation);
  if (unbound !== null) return unbound;
  if (!liveness.live) {
    if (liveness.why !== null) await recordLapse(tx, context, liveness.delegation, liveness.why);
    return refused('delegation_lapsed', { delegationId, why: liveness.why });
  }
  const beat = beatPrincipal(liveness.delegation, liveness.grants, harness.jdArea, context.at);
  if (allowed(beat, 'write', harness, context.at)) return null;
  return refused('not_permitted', { delegationId, why: 'delegation_capability' });
}

async function takeClaim(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
  delegationId: string | null,
): Promise<KernelOutcome<Claimed>> {
  const { caller, harness, stage, context } = scene;
  const { at } = context;
  if (item.holder !== null && !leaseLapsed(item, at)) {
    return refused('lease_held', { holder: item.holder, leaseExpiresAt: item.leaseExpiresAt });
  }
  const held = await tx.harnessItems.read.heldInStage(harness.id, stage.key, at);
  if (held >= stage.wipLimit) {
    return refused('wip_limit_reached', { stage: stage.key, wipLimit: stage.wipLimit });
  }
  const leaseExpiresAt = caller.actor.kind === 'agent' ? new Date(at.getTime() + LEASE_MS) : null;
  const won = await tx.harnessItems.write.claim({
    itemId: item.itemId,
    holder: caller.actor.identity,
    claimantKind: caller.actor.kind,
    delegationId,
    leaseExpiresAt,
    at,
  });
  if (!won) return refused('lease_held', { holder: item.holder });
  const recorded = await recordItemEvents(tx, context, item.itemId, [
    ...lapseDrafts(item, at),
    draft('item_claimed', {
      holder: caller.actor.identity,
      claimantKind: caller.actor.kind,
      delegationId,
      leaseExpiresAt: leaseExpiresAt === null ? null : leaseExpiresAt.toISOString(),
    }),
  ]);
  return accepted({
    item: recorded.item,
    leaseExpiresAt: recorded.item.leaseExpiresAt,
    leaseWarning: false,
  });
}

async function sceneOf(
  ports: ClaimPorts,
  tx: StoreTransaction,
  caller: Caller,
  pre: ItemState,
  at: Date,
): Promise<Scene | Refused> {
  const harness = await tx.harnesses.read.byId(pre.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: pre.harnessId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.key === pre.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stage: pre.stageKey });
  return { caller, harness, stage, context: recordContext(ports, caller, at) };
}

async function claimIn(
  ports: ClaimPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: ClaimInput,
  at: Date,
): Promise<KernelOutcome<Claimed>> {
  const pre = await tx.harnessItems.read.byId(input.itemId);
  if (pre === null) return refused('item_not_found', { itemId: input.itemId });
  const scene = await sceneOf(ports, tx, caller, pre, at);
  if ('status' in scene) return scene;
  const early = claimGuards(scene, pre);
  if (early !== null) return early;
  await tx.lock(lockKeys.stageClaims(scene.stage.id));
  const item = await tx.harnessItems.read.lock(input.itemId);
  if (item === null) return refused('item_not_found', { itemId: input.itemId });
  const stale = lockedGuards(scene, item);
  if (stale !== null) return stale;
  const denied = await delegationGuard(tx, ports, scene, item, input.delegationId);
  if (denied !== null) return denied;
  return takeClaim(tx, scene, item, input.delegationId);
}

export function claim(
  ports: ClaimPorts,
  caller: Caller,
  input: ClaimInput,
): Promise<KernelOutcome<Claimed>> {
  const at = ports.clock.now();
  return ports.store.transaction((tx) => claimIn(ports, tx, caller, input, at));
}

export function release(
  ports: Pick<Ports, 'clock' | 'ids' | 'store'>,
  caller: Caller,
  input: { readonly itemId: string },
): Promise<KernelOutcome<ItemState>> {
  const at = ports.clock.now();
  return ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(input.itemId);
    if (item === null) return refused('item_not_found', { itemId: input.itemId });
    const harness = await tx.harnesses.read.byId(item.harnessId);
    if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
    const holds = item.holder !== null && item.holder === caller.actor.identity;
    if (item.holder === null || !(holds || allowed(caller.actor, 'admin', harness, at))) {
      return refused('not_holder', { itemId: item.itemId });
    }
    const recorded = await recordItemEvents(tx, recordContext(ports, caller, at), item.itemId, [
      draft('item_released', { holder: item.holder }),
    ]);
    return accepted(recorded.item);
  });
}
