import type { Harness, ItemState, Stage } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal, recordDelegationRequired } from '../delegations/acting.ts';
import {
  adoptionOf,
  claimedBranch,
  readBranchTip,
  type BranchTip,
  type ClaimedBranch,
} from './adopt.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { lapseDrafts, LEASE_MS, leaseLapsed } from './leases.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from './record.ts';

type ClaimPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store'>;

export type Claimed = {
  readonly item: ItemState;
  readonly leaseExpiresAt: string | null;
  readonly leaseWarning: boolean;
  readonly branch: ClaimedBranch;
};

export type ClaimInput = {
  readonly itemId: string;
  readonly delegationId: string | null;
  readonly adoptBranch?: boolean;
};

type Taking = { readonly delegationId: string | null; readonly tip: BranchTip | null };

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
  return gateRefusal(item) ?? pickupRefusal(caller, stage);
}

function pickupRefusal(caller: Caller, stage: Stage): Refused | null {
  if (isAgent(caller.actor) && stage.agentPickup === 'none') {
    return refused('pickup_not_allowed', { stage: stage.key });
  }
  return null;
}

function lockedGuards(scene: Scene, item: ItemState): Refused | null {
  if (item.stageKey !== scene.stage.key) return refused('not_permitted', { why: 'moved' });
  return gateRefusal(item) ?? pickupRefusal(scene.caller, scene.stage);
}

async function actingGuard(
  tx: StoreTransaction,
  ports: ClaimPorts,
  scene: Scene,
  item: ItemState,
  delegationId: string | null,
): Promise<Refused | null> {
  const { caller, harness, stage, context } = scene;
  const acting = await actingPrincipal(ports, tx, { caller, harness, delegationId, context });
  if (isRefusal(acting)) {
    if (acting.reason !== 'delegation_required') return acting;
    return recordDelegationRequired(tx, context, item.itemId, stage.key);
  }
  if (allowed(acting, 'write', harness, context.at)) return null;
  return refused('not_permitted', { harnessId: harness.id, delegationId });
}

async function takeClaim(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
  { delegationId, tip }: Taking,
): Promise<KernelOutcome<Claimed>> {
  const { caller, harness, stage, context } = scene;
  const { at } = context;
  if (item.holder !== null && !leaseLapsed(item, at)) {
    return refused('lease_held', { holder: item.holder, leaseExpiresAt: item.leaseExpiresAt });
  }
  const adoption = await adoptionOf(tx, { item, harness }, tip, at);
  if ('status' in adoption) return adoption;
  const held = await tx.harnessItems.read.heldInStage(harness.id, stage.key, at);
  if (held >= stage.wipLimit) {
    return refused('wip_limit_reached', { stage: stage.key, wipLimit: stage.wipLimit });
  }
  const leaseExpiresAt = isAgent(caller.actor) ? new Date(at.getTime() + LEASE_MS) : null;
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
    ...(adoption.head === null ? [] : [draft('branch_adopted', { head: adoption.head })]),
  ]);
  return accepted({
    item: recorded.item,
    leaseExpiresAt: recorded.item.leaseExpiresAt,
    leaseWarning: false,
    branch: claimedBranch(item, adoption),
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
  { input, tip }: { readonly input: ClaimInput; readonly tip: BranchTip | null },
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
  const stages = await tx.harnessStages.read.forHarness(scene.harness.id);
  const stage = stages.find((entry) => entry.id === scene.stage.id);
  if (stage === undefined) return refused('stage_not_found', { stage: scene.stage.key });
  const locked = { ...scene, stage };
  const stale = lockedGuards(locked, item);
  if (stale !== null) return stale;
  const denied = await actingGuard(tx, ports, locked, item, input.delegationId);
  if (denied !== null) return denied;
  return takeClaim(tx, locked, item, { delegationId: input.delegationId, tip });
}

export async function claim(
  ports: ClaimPorts,
  caller: Caller,
  input: ClaimInput,
): Promise<KernelOutcome<Claimed>> {
  const tip = input.adoptBranch === true ? await readBranchTip(ports, input.itemId) : null;
  const at = ports.clock.now();
  return ports.store.transaction((tx) => claimIn(ports, tx, caller, { input, tip }, at));
}
