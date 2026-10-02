import type { GateDecision, Harness, ItemState, Principal, Stage } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import {
  draft,
  recordContext,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from '../items/record.ts';
import { exitDrafts, resolveExit, type Exit } from '../items/transitions.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { approverCovers } from '../risk/domain-grants.ts';

type GatePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store'>;

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

function humanPrincipal(actor: Principal): boolean {
  return actor.kind === 'person' && actor.identity.startsWith('human:');
}

function refuseAgent(
  ports: GatePorts,
  caller: Caller,
  input: DecideInput,
  at: Date,
): Promise<Refused> {
  return ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(input.itemId);
    if (item === null) return refused('item_not_found', { itemId: input.itemId });
    await recordItemEvents(tx, recordContext(ports, caller, at), item.itemId, [
      draft('gate_refused_to_agent', { decision: input.decision, stage: item.stageKey }),
    ]);
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

async function standing(
  ports: GatePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: DecideInput,
  at: Date,
): Promise<Gate | Refused> {
  const item = await tx.harnessItems.read.lock(input.itemId);
  if (item === null) return refused('item_not_found', { itemId: input.itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('harness_not_found', { harnessId: item.harnessId });
  const stages = await tx.harnessStages.read.forHarness(harness.id);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined) return refused('stage_not_found', { stage: item.stageKey });
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
  return { item, harness, stages, stage, approver, context: recordContext(ports, caller, at) };
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

function exitOf(gate: Gate): Exit | Refused {
  const { item, stages, stage } = gate;
  if (item.gateTarget !== null) {
    const target = resolveExit(stages, stage, item.gateTarget);
    if (target === null) {
      return refused('transition_not_allowed', { from: stage.key, to: item.gateTarget });
    }
    if (target.kind === 'loop') return target;
  }
  if (stage.connector !== 'none') {
    return refused('not_wired', { stage: stage.key, connector: stage.connector });
  }
  return resolveExit(stages, stage, null) ?? refused('transition_not_allowed', { from: stage.key });
}

async function recordDecision(
  tx: StoreTransaction,
  gate: Gate,
  input: DecideInput,
  exit: Exit | null,
): Promise<KernelOutcome<Decided>> {
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
  const drafts = [draftOf(decisionId, gate, input), ...(exit === null ? [] : exitDrafts(exit))];
  const recorded = await recordItemEvents(tx, context, item.itemId, drafts);
  return accepted({ decisionId, item: recorded.item, advanced: exit !== null });
}

async function decideIn(
  ports: GatePorts,
  tx: StoreTransaction,
  caller: Caller,
  input: DecideInput,
  at: Date,
): Promise<KernelOutcome<Decided>> {
  const gate = await standing(ports, tx, caller, input, at);
  if (isRefused(gate)) return gate;
  const denied = await approverRefusal(tx, gate, input.decision);
  if (denied !== null) return denied;
  const exit = advancing.has(input.decision) ? exitOf(gate) : null;
  if (exit !== null && isRefused(exit)) return exit;
  return recordDecision(tx, gate, input, exit);
}

export function decide(
  ports: GatePorts,
  caller: Caller,
  input: DecideInput,
): Promise<KernelOutcome<Decided>> {
  const at = ports.clock.now();
  if (!humanPrincipal(caller.actor)) return refuseAgent(ports, caller, input, at);
  const checked = normalised(input);
  if (isRefused(checked)) return Promise.resolve(checked);
  return ports.store.transaction((tx) => decideIn(ports, tx, caller, checked, at));
}
