import type { GateDecision, Harness, ItemState, Principal, Stage } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import {
  draft,
  recordContext,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from '../items/record.ts';
import { lockKeys } from '../lock-keys.ts';
import { exitDrafts, resolveExit, type Exit } from '../items/transitions.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { EffectConnector, Ports, StoreTransaction } from '../ports.ts';
import { approverCovers } from '../risk/domain-grants.ts';
import {
  effectOf,
  exitAfterDecision,
  inFlightRefusal,
  readShipFacts,
  shipCheck,
  type PendingExit,
  type ShipCheck,
  type ShipSnapshot,
} from './approve-at-ship.ts';
import type { ExitPorts } from './exit.ts';

export type GatePorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store'> &
  ExitPorts;

export type DecideInput = {
  readonly itemId: string;
  readonly decision: GateDecision;
  readonly reason: string | null;
  readonly findings: readonly string[];
};

export type Decided = {
  readonly decisionId: string;
  readonly item: ItemState;
  readonly advanced: boolean;
};

type Gate = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stages: readonly Stage[];
  readonly stage: Stage;
  readonly approver: Principal;
  readonly context: RecordContext;
};

type DraftOf = (decisionId: string, gate: Gate, input: DecideInput) => EventDraft;

const FINDING_LIMIT = 500;
const REASON_LIMIT = 2000;

const advancing: ReadonlySet<GateDecision> = new Set<GateDecision>(['approve', 'override']);

const decisionDrafts: ReadonlyMap<GateDecision, DraftOf> = new Map<GateDecision, DraftOf>([
  ['approve', (decisionId, gate) => draft('gate_approved', { decisionId, stage: gate.stage.key })],
  [
    'override',
    (decisionId, gate, input) =>
      draft('gate_overridden', { decisionId, stage: gate.stage.key, reason: input.reason ?? '' }),
  ],
  [
    'reject',
    (decisionId, gate, input) =>
      draft('gate_rejected', {
        decisionId,
        stage: gate.stage.key,
        findings: [...input.findings],
      }),
  ],
  [
    'take_over',
    (decisionId, gate) =>
      draft('gate_taken_over', {
        decisionId,
        stage: gate.stage.key,
        holder: gate.approver.identity,
      }),
  ],
]);

function isRefused<T extends object>(value: T | Refused): value is Refused {
  return 'status' in value;
}

function refuseAgent(
  ports: GatePorts,
  caller: Caller,
  input: DecideInput,
  at: Date,
): Promise<Refused> {
  return ports.store.transaction(async (tx) => {
    const notFound = refused('item_not_found', { itemId: input.itemId });
    const item = await tx.harnessItems.read.lock(input.itemId);
    if (item === null) return notFound;
    const harness = await tx.harnesses.read.byId(item.harnessId);
    if (harness === null) return notFound;
    await recordItemEvents(tx, recordContext(ports, caller, at), item.itemId, [
      draft('gate_refused_to_agent', { decision: input.decision, stage: item.stageKey }),
    ]);
    if (!allowed(caller.actor, 'read', harness, at)) return notFound;
    return refused('gate_refused_to_agent', { actor: caller.actor.identity });
  });
}

function trimmedOrNull(text: string | null): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function normalised(input: DecideInput): DecideInput | Refused {
  const reason = trimmedOrNull(input.reason);
  if (input.decision === 'override' && reason === null) {
    return refused('reason_required', { decision: input.decision });
  }
  if (reason !== null && reason.length > REASON_LIMIT) {
    return refused('malformed_command', { reasonLimit: REASON_LIMIT });
  }
  const findings = input.findings.map((finding) => finding.trim());
  if (findings.some((finding) => finding === '' || finding.length > FINDING_LIMIT)) {
    return refused('malformed_command', { findingLimit: FINDING_LIMIT });
  }
  const kept = input.decision === 'override' || input.decision === 'reject' ? reason : null;
  return { ...input, reason: kept, findings };
}

type Placed = Pick<Gate, 'item' | 'harness' | 'stages' | 'stage'>;

async function placed(tx: StoreTransaction, itemId: string): Promise<Placed | Refused> {
  const pre = await tx.harnessItems.read.byId(itemId);
  if (pre === null) return refused('item_not_found', { itemId });
  const harness = await tx.harnesses.read.byId(pre.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: pre.harnessId });
  const before = await tx.harnessStages.read.forHarness(harness.id);
  const claimed = before.find((entry) => entry.key === pre.stageKey);
  if (claimed === undefined) return refused('stage_not_found', { stage: pre.stageKey });
  await tx.lock(lockKeys.stageClaims(claimed.id));
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.id === claimed.id);
  if (stage === undefined) return refused('stage_not_found', { stage: claimed.key });
  if (item.stageKey !== stage.key) {
    return refused('item_not_at_gate', { itemId, gateStatus: item.gateStatus, why: 'moved' });
  }
  return { item, harness, stages, stage };
}

async function standing(
  ports: GatePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: DecideInput,
  at: Date,
): Promise<Gate | Refused> {
  const place = await placed(tx, input.itemId);
  if (isRefused(place)) return place;
  const { item, harness } = place;
  const { actor } = caller;
  if (!allowed(actor, 'admin', harness, at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  if (item.gateStatus !== 'parked') {
    return refused('item_not_at_gate', { itemId: item.itemId, gateStatus: item.gateStatus });
  }
  if (actor.personId === null || actor.identity !== `human:${actor.personId}`) {
    return refused('not_permitted', { actor: actor.identity });
  }
  const grants = await ports.grants.lockAndReread(tx, actor.personId, at);
  const approver = { ...actor, grants: [...grants] };
  return { ...place, approver, context: recordContext(ports, caller, at) };
}

async function wipRefusal(
  tx: StoreTransaction,
  gate: Gate,
  decision: GateDecision,
): Promise<Refused | null> {
  if (decision !== 'take_over') return null;
  const { harness, stage, context } = gate;
  const held = await tx.harnessItems.read.heldInStage(harness.id, stage.key, context.at);
  if (held < stage.wipLimit) return null;
  return refused('wip_limit_reached', { stage: stage.key, wipLimit: stage.wipLimit });
}

async function approverRefusal(
  tx: StoreTransaction,
  gate: Gate,
  decision: GateDecision,
): Promise<Refused | null> {
  const { item, harness, stage, approver, context } = gate;
  if (!advancing.has(decision)) {
    return allowed(approver, 'admin', harness, context.at)
      ? null
      : refused('not_permitted', { harnessId: harness.id });
  }
  if (approverCovers(approver, harness.jdArea, item.riskDomains, context.at)) return null;
  await recordItemEvents(tx, context, item.itemId, [
    draft('ship_refused', { stage: stage.key, reasons: ['approver_lacks_domain_grant'] }),
  ]);
  return refused('approver_lacks_domain_grant', { stage: stage.key });
}

type Route = { readonly exit: Exit | null; readonly connector: EffectConnector | null };

function routeOf(gate: Gate, decision: GateDecision): Route | Refused {
  if (!advancing.has(decision)) return { exit: null, connector: null };
  const { item, stages, stage } = gate;
  if (item.gateTarget !== null) {
    const target = resolveExit(stages, stage, item.gateTarget);
    if (target === null) {
      return refused('transition_not_allowed', { from: stage.key, to: item.gateTarget });
    }
    if (target.kind === 'loop') return { exit: target, connector: null };
  }
  const forward = resolveExit(stages, stage, null);
  if (forward === null) return refused('transition_not_allowed', { from: stage.key });
  return { exit: forward, connector: effectOf(stage.connector) };
}

type Decision = {
  readonly input: DecideInput;
  readonly exit: Exit | null;
  readonly before: readonly EventDraft[];
};

async function recordDecision(
  tx: StoreTransaction,
  gate: Gate,
  decision: Decision,
): Promise<KernelOutcome<Decided>> {
  const { input, exit } = decision;
  const { item, stage, approver, context } = gate;
  const draftOf = decisionDrafts.get(input.decision);
  if (draftOf === undefined) return refused('malformed_command', { decision: input.decision });
  const decisionId = context.ids.next();
  await tx.gateDecisions.write.insert({
    id: decisionId,
    harnessId: item.harnessId,
    itemId: item.itemId,
    stageId: stage.id,
    actor: approver.identity,
    decision: input.decision,
    reason: input.reason,
    evidence: { findings: [...input.findings], gateTarget: item.gateTarget },
    traceId: context.traceId,
    decidedAt: context.at,
  });
  const drafts = [
    ...decision.before,
    draftOf(decisionId, gate, input),
    ...(exit === null ? [] : exitDrafts(exit)),
  ];
  const recorded = await recordItemEvents(tx, context, item.itemId, drafts);
  return accepted({ decisionId, item: recorded.item, advanced: exit !== null });
}

type Committed = { readonly decided: Decided; readonly pending: PendingExit | null };

type Request = {
  readonly caller: Caller;
  readonly input: DecideInput;
  readonly at: Date;
  readonly snapshot: ShipSnapshot | null;
};

type ShipRoute = { readonly exit: Exit; readonly connector: EffectConnector };

function pendingExit(
  gate: Gate,
  decided: Decided,
  route: ShipRoute,
  request: Request,
): PendingExit {
  const { input, snapshot } = request;
  return {
    item: decided.item,
    stage: gate.stage,
    connector: route.connector,
    next: route.exit.to,
    decisionId: decided.decisionId,
    overrideReason: input.decision === 'override' ? input.reason : null,
    repository: gate.harness.repository,
    expectedBase: snapshot?.facts?.base ?? null,
    context: gate.context,
  };
}

async function openRoute(
  tx: StoreTransaction,
  gate: Gate,
  decision: GateDecision,
): Promise<Route | Refused> {
  const inFlight = await inFlightRefusal(tx, gate.item);
  return inFlight ?? routeOf(gate, decision);
}

async function checkedRoute(
  tx: StoreTransaction,
  gate: Gate,
  decision: GateDecision,
  routed: { readonly route: Route; readonly snapshot: ShipSnapshot | null },
): Promise<ShipCheck> {
  if (routed.route.connector !== null) return shipCheck(tx, gate, decision, routed.snapshot);
  return { refusal: await approverRefusal(tx, gate, decision), drafts: [] };
}

async function decideIn(
  ports: GatePorts,
  tx: StoreTransaction,
  request: Request,
): Promise<KernelOutcome<Committed>> {
  const { input, snapshot } = request;
  const gate = await standing(ports, tx, request.caller, input, request.at);
  if (isRefused(gate)) return gate;
  const route = await openRoute(tx, gate, input.decision);
  if (isRefused(route)) return route;
  const ship = await checkedRoute(tx, gate, input.decision, { route, snapshot });
  if (ship.refusal !== null) return ship.refusal;
  const full = await wipRefusal(tx, gate, input.decision);
  if (full !== null) return full;
  const { exit, connector } = route;
  const recorded = await recordDecision(tx, gate, {
    input,
    exit: connector === null ? exit : null,
    before: ship.drafts,
  });
  if (recorded.status !== 'accepted') return recorded;
  const decided = recorded.value;
  const pending =
    connector !== null && exit !== null
      ? pendingExit(gate, decided, { exit, connector }, request)
      : null;
  return accepted({ decided, pending });
}

export async function decide(
  ports: GatePorts,
  caller: Caller,
  input: DecideInput,
): Promise<KernelOutcome<Decided>> {
  const at = ports.clock.now();
  if (isAgent(caller.actor)) return refuseAgent(ports, caller, input, at);
  const checked = normalised(input);
  if (isRefused(checked)) return checked;
  const snapshot = await readShipFacts(ports, {
    actor: caller.actor,
    at,
    itemId: checked.itemId,
    decision: checked.decision,
  });
  if (snapshot !== null && isRefused(snapshot)) return snapshot;
  const request = { caller, input: checked, at, snapshot };
  const outcome = await ports.store.transaction((tx) => decideIn(ports, tx, request));
  if (outcome.status !== 'accepted') return outcome;
  const { decided, pending } = outcome.value;
  if (pending === null) return accepted(decided);
  return accepted({ ...decided, ...(await exitAfterDecision(ports, pending)) });
}
