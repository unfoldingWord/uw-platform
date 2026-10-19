import type { DelegatedMerge, Harness, ItemState, Stage } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { recordDelegationRequired } from '../delegations/acting.ts';
import { draft, recordItemEvents, type RecordContext } from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import type { Refused } from '../outcome.ts';
import type { Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { inFlightRefusal, shipCheck, type ShipCheck } from './approve-at-ship.ts';
import { delegableExit } from './delegable.ts';
import { factsFailure } from './facts-failure.ts';
import { isStale, staleRefusal } from './facts-fresh.ts';
import { lentInDecision, type Lent } from './lent.ts';

export type DelegatedPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'store'>;

export type DelegatedRead = {
  readonly facts: PullRequestFacts | null;
  readonly email: string | null;
};

export type DelegatedScene = {
  readonly caller: Caller;
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly stage: Stage;
  readonly delegationId: string;
  readonly context: RecordContext;
  readonly read: DelegatedRead;
};

export type DelegatedOutcome = { readonly item: ItemState; readonly failures: readonly string[] };

type AtExit = { readonly item: ItemState; readonly harness: Harness; readonly personId: string };

type Standing = {
  readonly caller: Caller;
  readonly item: ItemState;
  readonly stage: Stage;
  readonly context: RecordContext;
};

async function atDelegableExit(tx: StoreTransaction, itemId: string): Promise<AtExit | null> {
  const item = await tx.harnessItems.read.byId(itemId);
  if (item === null || item.delegationId === null) return null;
  const delegation = await tx.delegations.read.byId(item.delegationId);
  if (delegation?.capability !== 'merge') return null;
  const harness = await tx.harnesses.read.byId(item.harnessId);
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (harness === null || stage === undefined || !delegableExit(stage)) return null;
  return { item, harness, personId: delegation.personId };
}

export async function delegatedPreRead(
  ports: DelegatedPorts,
  caller: Caller,
  itemId: string,
): Promise<DelegatedRead | Refused | null> {
  if (!isAgent(caller.actor)) return null;
  const found = await ports.store.transaction((tx) => atDelegableExit(tx, itemId));
  if (found === null) return null;
  const holders = await ports.grants.holders(found.harness.jdArea, ports.clock.now());
  const email = holders.find((holder) => holder.personId === found.personId)?.email ?? null;
  const ref = found.item.pullRequest;
  if (ref === null) return { facts: null, email };
  try {
    const facts = await ports.githubFacts.refresh(ref);
    return facts !== null && isStale(facts, ports.clock.now())
      ? staleRefusal(facts)
      : { facts, email };
  } catch (error) {
    return factsFailure(error);
  }
}

type AtStage = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stage: Stage;
  readonly context: RecordContext;
};

export async function agentInFlightRefusal(
  tx: StoreTransaction,
  caller: Caller,
  { item, harness, stage, context }: AtStage,
): Promise<Refused | null> {
  if (!isAgent(caller.actor) || !delegableExit(stage)) return null;
  if (!allowed(caller.actor, 'write', harness, context.at)) return null;
  return inFlightRefusal(tx, item);
}

export async function delegationRequiredAtShip(
  tx: StoreTransaction,
  standing: Standing,
): Promise<Refused | null> {
  const { caller, item, stage, context } = standing;
  if (!isAgent(caller.actor) || !delegableExit(stage)) return null;
  const delegation =
    item.delegationId === null ? null : await tx.delegations.read.byId(item.delegationId);
  if (delegation?.capability === 'merge') return null;
  return recordDelegationRequired(tx, context, item.itemId, stage.key);
}

function heldBack(scene: DelegatedScene): string | null {
  if (scene.harness.shadow) return 'shadow';
  return scene.item.gateTarget === null ? null : 'gate_target';
}

function reasonsOf(refusal: Refused): readonly string[] {
  const reasons = refusal.detail['reasons'];
  return typeof reasons === 'object' && reasons !== null ? [...reasons] : [refusal.reason];
}

function delegatedMergeOf(decisionId: string, found: Lent): DelegatedMerge {
  const { delegation, approver, lent } = found;
  return {
    decisionId,
    delegationId: delegation.id,
    personId: delegation.personId,
    email: approver.email ?? '',
    persona: delegation.persona,
    expiresAt: delegation.expiresAt.toISOString(),
    maxTier: lent.maxTier,
  };
}

type Decided = { readonly found: Lent; readonly ship: ShipCheck };

async function recordDelegatedDecision(
  tx: StoreTransaction,
  scene: DelegatedScene,
  decided: Decided,
): Promise<DelegatedOutcome> {
  const { item, stages, stage, context } = scene;
  const { found, ship } = decided;
  const decisionId = context.ids.next();
  const shipped =
    ship.shipped === null
      ? {}
      : {
          head: ship.shipped.head,
          approvals: ship.shipped.approvals.map((entry) => ({ ...entry })),
        };
  await tx.gateDecisions.write.insert({
    id: decisionId,
    harnessId: item.harnessId,
    itemId: item.itemId,
    stageId: stage.id,
    actor: found.approver.identity,
    agentActor: found.delegation.persona,
    delegationId: found.delegation.id,
    decision: 'approve',
    reason: null,
    evidence: {
      findings: [],
      gateTarget: null,
      connector: 'merge',
      next: resolveExit(stages, stage, null)?.to?.key ?? null,
      ...shipped,
      delegation: { ...delegatedMergeOf(decisionId, found) },
    },
    traceId: context.traceId,
    decidedAt: context.at,
  });
  const drafts = [...ship.drafts, draft('gate_approved', { decisionId, stage: stage.key })];
  const recorded = await recordItemEvents(tx, context, item.itemId, drafts);
  return { item: recorded.item, failures: [] };
}

export async function shipUnderDelegation(
  ports: DelegatedPorts,
  tx: StoreTransaction,
  scene: DelegatedScene,
): Promise<DelegatedOutcome | null> {
  const { item, harness, stage, context, read } = scene;
  if (!delegableExit(stage) || item.gateStatus !== 'parked') return null;
  const held = heldBack(scene);
  if (held !== null) return { item, failures: [held] };
  const found = await lentInDecision(ports, tx, {
    delegationId: scene.delegationId,
    email: read.email,
    context,
  });
  if (typeof found === 'string') return { item, failures: [found] };
  const gate = { item, harness, stage, approver: found.approver, context };
  const ship = await shipCheck(tx, gate, 'approve', { item, facts: read.facts }, found.lent);
  if (ship.refusal !== null) return { item, failures: reasonsOf(ship.refusal) };
  return recordDelegatedDecision(tx, scene, { found, ship });
}
