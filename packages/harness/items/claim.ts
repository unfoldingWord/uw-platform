import type { Harness, ItemState, Stage } from '@uw/contracts';
import { allowed, bareAgent, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { actingPrincipal, isRefusal, recordDelegationRequired } from '../delegations/acting.ts';
import { capabilityReaches, pageAgrees } from '../delegations/capability.ts';
import { delegableExit } from '../gates/delegable.ts';
import {
  adoptionOf,
  claimedBranch,
  readBranchTip,
  type BranchTip,
  type ClaimedBranch,
} from './adopt.ts';
import { lockKeys } from '../lock-keys.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Delegation, Ports, StoreTransaction } from '../ports.ts';
import { engineDescriptor } from '../engines.ts';
import { spendRefusal } from '../runs/breaker-level.ts';
import { activePersonaOn, personaIdentityFor } from '../personas/projection.ts';
import { personaPageOf } from '../runs/persona.ts';
import { endRunDrafts, stopWorkflows } from '../runs/ends.ts';
import { dispatchRefusal } from './dispatch.ts';
import { fixClaiming, readFixStart, type FixRead } from './fix-claim.ts';
import { blockedRefusal } from './blockers.ts';
import { personHoldRefusal } from './held-for-person.ts';
import { lapseDrafts, LEASE_MS, leaseLapsed } from './leases.ts';
import { pausedRefusal } from './paused.ts';
import {
  draft,
  recordContext,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from './record.ts';

type ClaimPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store' | 'runs'>;

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

export type ClaimTaken = {
  readonly drafts: readonly EventDraft[];
  readonly branch: ClaimedBranch;
  readonly hosted: string | null;
};

type Taking = { readonly delegationId: string | null; readonly tip: BranchTip | null };

type Claiming = {
  readonly input: ClaimInput;
  readonly tip: BranchTip | null;
  readonly fix: FixRead;
};

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
  if (isAgent(caller.actor) && stage.agentPickup === 'none' && !delegableExit(stage)) {
    return refused('pickup_not_allowed', { stage: stage.key });
  }
  return null;
}

async function unlentRefusal(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
  delegationId: string | null,
): Promise<Refused | null> {
  const { caller, stage, context } = scene;
  if (!isAgent(caller.actor) || !delegableExit(stage) || delegationId !== null) return null;
  return recordDelegationRequired(tx, context, item.itemId, stage.key);
}

function mergeReach(stage: Stage, delegation: Delegation): Refused | null {
  if (delegation.capability === 'merge' && delegableExit(stage)) return null;
  return refused('pickup_not_allowed', { stage: stage.key, capability: delegation.capability });
}

function lockedGuards(scene: Scene, item: ItemState): Refused | null {
  if (item.stageKey !== scene.stage.key) return refused('not_permitted', { why: 'moved' });
  const { caller, harness, stage } = scene;
  return gateRefusal(item) ?? pickupRefusal(caller, stage) ?? pausedRefusal(caller, harness, stage);
}

async function hostedBuilderRefusal(
  tx: StoreTransaction,
  caller: Caller,
  harness: Harness,
): Promise<Refused | null> {
  if (harness.hostedBuilderEnabled) return null;
  const page = personaPageOf(
    (await activePersonaOn(tx, caller.actor.identity, harness.id)) ?? undefined,
  );
  if (page === null || !engineDescriptor(page.frontmatter.engine).needsHostedBuilder) return null;
  return refused('hosted_builder_off', { harnessId: harness.id });
}

async function bareRefusal(tx: StoreTransaction, scene: Scene): Promise<Refused | null> {
  const { caller, harness, context } = scene;
  if (!bareAgent(caller.actor.identity)) return null;
  return (await hostedBuilderRefusal(tx, caller, harness)) ?? (await spendRefusal(tx, context.at));
}

async function dispatchGuard(tx: StoreTransaction, scene: Scene): Promise<Refused | null> {
  return isAgent(scene.caller.actor) ? dispatchRefusal(tx, scene.harness) : null;
}

async function heldRefusal(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
): Promise<Refused | null> {
  return (
    (await bareRefusal(tx, scene)) ??
    (await personHoldRefusal(tx, scene.caller, item)) ??
    (await blockedRefusal(tx, scene.caller, item)) ??
    (await dispatchGuard(tx, scene))
  );
}

async function inactivePersonaRefusal(
  tx: StoreTransaction,
  caller: Caller,
  harness: Harness,
): Promise<Refused | null> {
  const persona = personaIdentityFor(caller.actor.identity);
  if (persona === null || (await activePersonaOn(tx, persona, harness.id)) !== null) return null;
  return refused('not_permitted', { why: 'persona_not_active' });
}

async function capabilityRefusal(
  tx: StoreTransaction,
  scene: Scene,
  delegationId: string | null,
): Promise<Refused | null> {
  if (delegationId === null) return null;
  const delegation = await tx.delegations.read.byId(delegationId);
  if (delegation === null) return null;
  const { harness, stage } = scene;
  if (delegation.capability === 'merge' || delegableExit(stage))
    return mergeReach(stage, delegation);
  const page = await activePersonaOn(tx, delegation.persona, harness.id);
  if (capabilityReaches(delegation.capability, stage.bracket) && pageAgrees(page, delegation)) {
    return null;
  }
  return refused('pickup_not_allowed', { stage: stage.key, capability: delegation.capability });
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
  if (allowed(acting, 'write', harness, context.at)) {
    return (
      (await inactivePersonaRefusal(tx, caller, harness)) ??
      (await capabilityRefusal(tx, scene, delegationId))
    );
  }
  return refused('not_permitted', { harnessId: harness.id, delegationId });
}

async function takeClaim(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
  { delegationId, tip }: Taking,
): Promise<KernelOutcome<ClaimTaken>> {
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
  const lapse = lapseDrafts(item, at);
  const ending =
    lapse.length === 0
      ? { drafts: [], hosted: null }
      : await endRunDrafts(tx, item, { outcome: 'stopped', why: 'lease_expired', at });
  return accepted({
    hosted: ending.hosted,
    drafts: [
      ...lapse,
      ...ending.drafts,
      draft('item_claimed', {
        holder: caller.actor.identity,
        claimantKind: caller.actor.kind,
        delegationId,
        leaseExpiresAt: leaseExpiresAt === null ? null : leaseExpiresAt.toISOString(),
      }),
      ...(adoption.head === null ? [] : [draft('branch_adopted', { head: adoption.head })]),
    ],
    branch: claimedBranch(item, adoption),
  });
}

async function takeWithFix(
  tx: StoreTransaction,
  scene: Scene,
  item: ItemState,
  taking: Taking & { readonly fix: FixRead },
): Promise<KernelOutcome<ClaimTaken>> {
  const fixing = await fixClaiming(tx, scene, item, taking);
  if ('status' in fixing) return fixing;
  const taken = await takeClaim(tx, scene, item, taking);
  if (taken.status !== 'accepted') return taken;
  return accepted({ ...taken.value, drafts: [...taken.value.drafts, ...fixing.drafts] });
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

async function rereadScene(tx: StoreTransaction, scene: Scene): Promise<Scene | Refused> {
  const harness = await tx.harnesses.read.byId(scene.harness.id);
  if (harness === null) return refused('harness_not_found', { harnessId: scene.harness.id });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.id === scene.stage.id);
  if (stage === undefined) return refused('stage_not_found', { stage: scene.stage.key });
  return { ...scene, harness, stage };
}

async function claimIn(
  ports: ClaimPorts,
  tx: StoreTransaction,
  caller: Caller,
  { input, tip, fix }: Claiming,
  at: Date,
): Promise<KernelOutcome<ClaimTaken>> {
  const pre = await tx.harnessItems.read.byId(input.itemId);
  if (pre === null) return refused('item_not_found', { itemId: input.itemId });
  const scene = await sceneOf(ports, tx, caller, pre, at);
  if ('status' in scene) return scene;
  const early = claimGuards(scene, pre);
  if (early !== null) return early;
  await tx.lock(lockKeys.stageClaims(scene.stage.id));
  const item = await tx.harnessItems.read.lock(input.itemId);
  if (item === null) return refused('item_not_found', { itemId: input.itemId });
  const locked = await rereadScene(tx, scene);
  if ('status' in locked) return locked;
  const stale =
    lockedGuards(locked, item) ??
    (await heldRefusal(tx, locked, item)) ??
    (await unlentRefusal(tx, locked, item, input.delegationId));
  if (stale !== null) return stale;
  const denied = await actingGuard(tx, ports, locked, item, input.delegationId);
  if (denied !== null) return denied;
  return takeWithFix(tx, locked, item, { delegationId: input.delegationId, tip, fix });
}

export function claimWithin(
  ports: ClaimPorts,
  tx: StoreTransaction,
  caller: Caller,
  claiming: { readonly input: ClaimInput; readonly at: Date; readonly fix?: FixRead },
): Promise<KernelOutcome<ClaimTaken>> {
  const { input, at, fix = null } = claiming;
  return claimIn(ports, tx, caller, { input, tip: null, fix }, at);
}

export async function claim(
  ports: ClaimPorts,
  caller: Caller,
  input: ClaimInput,
): Promise<KernelOutcome<Claimed>> {
  const tip = input.adoptBranch === true ? await readBranchTip(ports, input.itemId) : null;
  const fix = await readFixStart(ports, input.itemId, input.delegationId);
  const at = ports.clock.now();
  const outcome = await ports.store.transaction(async (tx) => {
    const taken = await claimIn(ports, tx, caller, { input, tip, fix }, at);
    if (taken.status !== 'accepted') return taken;
    const context = recordContext(ports, caller, at);
    const recorded = await recordItemEvents(tx, context, input.itemId, taken.value.drafts);
    const claimed: Claimed = {
      item: recorded.item,
      leaseExpiresAt: recorded.item.leaseExpiresAt,
      leaseWarning: false,
      branch: taken.value.branch,
    };
    return accepted({ claimed, hosted: taken.value.hosted });
  });
  if (outcome.status !== 'accepted') return outcome;
  await stopWorkflows(ports, [outcome.value.hosted]);
  return accepted(outcome.value.claimed);
}
