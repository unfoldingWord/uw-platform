import type {
  Connector,
  GateDecision,
  Harness,
  ItemState,
  Principal,
  RiskDomain,
  RiskTier,
  ShipRefusal,
  ShipRuleInput,
  ShipRuleOutcome,
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
import type {
  DecidedBase,
  EffectConnector,
  Ports,
  PullRequestFacts,
  StoreTransaction,
} from '../ports.ts';
import { countedApprovals, shipRule, type CountedApproval } from '../ship-rule.ts';
import { exitThroughConnector, type ExitGuard, type ExitPorts } from './exit.ts';
import { factsFailure } from './facts-failure.ts';
import { isStale, staleRefusal } from './facts-fresh.ts';
import { decisionInFlight, sameChange } from './parking.ts';
import { assembleShipInput, riskDerivedAtShip, type ShipInputSource } from './ship-input.ts';

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
  readonly expectedBase: DecidedBase | null;
  readonly evaluatedHead: string | null;
  readonly harness: Harness;
  readonly approver: Principal;
  readonly override: boolean;
  readonly context: RecordContext;
};

export type Shipped = {
  readonly head: string | null;
  readonly approvals: readonly CountedApproval[];
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

type ShipPreview = {
  readonly input: Omit<ShipRuleInput, 'approver'>;
  readonly outcome: ShipRuleOutcome;
  readonly derived: {
    readonly riskTier: RiskTier | null;
    readonly riskDomains: readonly RiskDomain[];
    readonly head: string | null;
  } | null;
};

export function shipPreview(source: ShipInputSource): ShipPreview {
  const { approver, ...input } = assembleShipInput(source);
  const evidence = riskDerivedAtShip(source);
  return {
    input,
    outcome: shipRule({ ...input, approver }),
    derived:
      evidence === null
        ? null
        : { riskTier: evidence.riskTier, riskDomains: evidence.riskDomains, head: evidence.head },
  };
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
  readonly shipped: Shipped | null;
};

type ShipVerdict = {
  readonly reasons: readonly ShipRefusal[];
  readonly derived: readonly EventDraft[];
  readonly shipped: Shipped | null;
};

function shipVerdict(
  gate: ShipGate,
  decision: GateDecision,
  snapshot: ShipSnapshot | null,
): ShipVerdict {
  if (snapshot === null || !sameChange(snapshot.item, gate.item)) {
    return { reasons: ['head_mismatch'], derived: [], shipped: null };
  }
  const source = {
    facts: snapshot.facts,
    item: gate.item,
    harness: gate.harness,
    approver: gate.approver,
    at: gate.context.at,
    override: decision === 'override',
  };
  const input = assembleShipInput(source);
  const outcome = shipRule(input);
  const evidence = riskDerivedAtShip(source);
  return {
    reasons: outcome.verdict === 'advance' ? [] : outcome.reasons,
    derived: evidence === null ? [] : [draft('risk_derived', evidence)],
    shipped: { head: input.pullRequest?.head ?? null, approvals: countedApprovals(input) },
  };
}

export async function shipCheck(
  tx: StoreTransaction,
  gate: ShipGate,
  decision: GateDecision,
  snapshot: ShipSnapshot | null,
): Promise<ShipCheck> {
  const { reasons, derived, shipped } = shipVerdict(gate, decision, snapshot);
  const [first] = reasons;
  if (first === undefined) return { refusal: null, drafts: derived, shipped };
  const stage = gate.stage.key;
  await recordItemEvents(tx, gate.context, gate.item.itemId, [
    ...derived,
    draft('ship_refused', { stage, reasons: [...reasons] }),
  ]);
  return { refusal: refused(first, { stage, reasons }), drafts: [], shipped: null };
}

type FactsAtExit = PullRequestFacts | null | 'unavailable';

async function factsAtExit(ports: ShipPorts, item: ItemState): Promise<FactsAtExit> {
  if (item.pullRequest === null) return null;
  try {
    return await ports.githubFacts.refresh(item.pullRequest);
  } catch {
    return 'unavailable';
  }
}

function exitGuard(ports: ShipPorts, pending: PendingExit): ExitGuard {
  return async () => {
    const facts = await factsAtExit(ports, pending.item);
    if (facts === 'unavailable') return { refused: 'ship_rule_unavailable' };
    const { item, harness, approver, override, context } = pending;
    const input = assembleShipInput({ facts, item, harness, approver, at: context.at, override });
    const outcome = shipRule(input);
    if (outcome.verdict === 'refuse') {
      return { refused: `ship_rule_refused: ${outcome.reasons.join(', ')}` };
    }
    return { head: input.pullRequest?.head ?? null };
  };
}

export async function exitAfterDecision(
  ports: ShipPorts,
  pending: PendingExit,
): Promise<{ readonly item: ItemState; readonly advanced: boolean }> {
  const guard = exitGuard(ports, pending);
  const advanced = await exitThroughConnector(ports, pending.context, pending, guard);
  const now = await ports.store.transaction((tx) => tx.harnessItems.read.byId(pending.item.itemId));
  return { item: now ?? pending.item, advanced };
}
