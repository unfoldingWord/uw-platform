import type {
  Connector,
  GateDecision,
  Harness,
  ItemState,
  Principal,
  ShipRefusal,
  Stage,
} from '@uw/contracts';
import { allowed } from '../access.ts';
import {
  draft,
  readAllEvents,
  recordItemEvents,
  type EventDraft,
  type RecordContext,
} from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import { refused, type Refused } from '../outcome.ts';
import type { EffectConnector, Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { shipRule } from '../ship-rule.ts';
import { exitThroughConnector, type ExitPorts } from './exit.ts';
import { factsFailure } from './facts-failure.ts';
import { isStale, staleRefusal } from './facts-fresh.ts';
import { decisionInFlight, sameChange } from './parking.ts';
import { assembleShipInput, riskDerivedAtShip } from './ship-input.ts';

type ShipPorts = Pick<Ports, 'githubFacts' | 'store'> & ExitPorts;

export type ShipRequest = {
  readonly actor: Principal;
  readonly at: Date;
  readonly itemId: string;
  readonly decision: GateDecision;
};

type AtExit = { readonly item: ItemState; readonly harness: Harness };

export type ShipSnapshot = { readonly item: ItemState; readonly facts: PullRequestFacts | null };

type ShipGate = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly stage: Stage;
  readonly approver: Principal;
  readonly context: RecordContext;
};

export type PendingExit = {
  readonly item: ItemState;
  readonly stage: Stage;
  readonly connector: EffectConnector;
  readonly next: Stage | null;
  readonly decisionId: string;
  readonly overrideReason: string | null;
  readonly repository: string | null;
  readonly expectedBase: string | null;
  readonly context: RecordContext;
};

const shipDecisions: ReadonlySet<GateDecision> = new Set<GateDecision>(['approve', 'override']);

export function effectOf(connector: Connector): EffectConnector | null {
  return connector === 'none' ? null : connector;
}

async function itemAtConnectorExit(tx: StoreTransaction, itemId: string): Promise<AtExit | null> {
  const item = await tx.harnessItems.read.byId(itemId);
  if (item === null || item.gateStatus !== 'parked') return null;
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return null;
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined || effectOf(stage.connector) === null) return null;
  if (item.gateTarget === null) return { item, harness };
  return resolveExit(stages, stage, item.gateTarget)?.kind === 'forward' ? { item, harness } : null;
}

export async function readShipFacts(
  ports: ShipPorts,
  request: ShipRequest,
): Promise<ShipSnapshot | Refused | null> {
  if (!shipDecisions.has(request.decision)) return null;
  const found = await ports.store.transaction((tx) => itemAtConnectorExit(tx, request.itemId));
  if (found === null) return null;
  const { item, harness } = found;
  if (!allowed(request.actor, 'admin', harness, request.at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  if (item.pullRequest === null) return { item, facts: null };
  try {
    const facts = await ports.githubFacts.refresh(item.pullRequest);
    return facts !== null && isStale(facts, request.at) ? staleRefusal(facts) : { item, facts };
  } catch (error) {
    return factsFailure(error);
  }
}

export async function inFlightRefusal(
  tx: StoreTransaction,
  item: ItemState,
): Promise<Refused | null> {
  const events = await readAllEvents(tx, item.harnessId, item.itemId);
  return decisionInFlight(events) ? refused('decision_in_flight', { itemId: item.itemId }) : null;
}

export type ShipCheck = {
  readonly refusal: Refused | null;
  readonly drafts: readonly EventDraft[];
};

type ShipVerdict = {
  readonly reasons: readonly ShipRefusal[];
  readonly derived: readonly EventDraft[];
};

function shipVerdict(
  gate: ShipGate,
  decision: GateDecision,
  snapshot: ShipSnapshot | null,
): ShipVerdict {
  if (snapshot === null || !sameChange(snapshot.item, gate.item)) {
    return { reasons: ['head_mismatch'], derived: [] };
  }
  const source = {
    facts: snapshot.facts,
    item: gate.item,
    harness: gate.harness,
    approver: gate.approver,
    at: gate.context.at,
    override: decision === 'override',
  };
  const outcome = shipRule(assembleShipInput(source));
  const evidence = riskDerivedAtShip(source);
  return {
    reasons: outcome.verdict === 'advance' ? [] : outcome.reasons,
    derived: evidence === null ? [] : [draft('risk_derived', evidence)],
  };
}

export async function shipCheck(
  tx: StoreTransaction,
  gate: ShipGate,
  decision: GateDecision,
  snapshot: ShipSnapshot | null,
): Promise<ShipCheck> {
  const { reasons, derived } = shipVerdict(gate, decision, snapshot);
  const [first] = reasons;
  if (first === undefined) return { refusal: null, drafts: derived };
  const stage = gate.stage.key;
  await recordItemEvents(tx, gate.context, gate.item.itemId, [
    ...derived,
    draft('ship_refused', { stage, reasons: [...reasons] }),
  ]);
  return { refusal: refused(first, { stage, reasons }), drafts: [] };
}

export async function exitAfterDecision(
  ports: ShipPorts,
  pending: PendingExit,
): Promise<{ readonly item: ItemState; readonly advanced: boolean }> {
  const advanced = await exitThroughConnector(ports, pending.context, pending);
  const now = await ports.store.transaction((tx) => tx.harnessItems.read.byId(pending.item.itemId));
  return { item: now ?? pending.item, advanced };
}
