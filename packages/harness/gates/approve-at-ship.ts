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
import { draft, readAllEvents, recordItemEvents, type RecordContext } from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import { refused, type Refused } from '../outcome.ts';
import { PortNotWiredError } from '../port-errors.ts';
import type { EffectConnector, Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { shipRule } from '../ship-rule.ts';
import { exitThroughConnector, type ExitPorts } from './exit.ts';
import { decisionInFlight, sameChange } from './parking.ts';
import { assembleShipInput } from './ship-input.ts';

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

function factsFailure(error: unknown): Refused {
  if (error instanceof PortNotWiredError) return refused('not_wired', { port: error.port });
  const name = error instanceof Error ? error.name : 'unknown';
  return refused('internal_error', { port: 'githubFacts', error: name });
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
    return { item, facts: await ports.githubFacts.pullRequest(item.pullRequest) };
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

function shipReasons(
  gate: ShipGate,
  decision: GateDecision,
  snapshot: ShipSnapshot | null,
): readonly ShipRefusal[] {
  if (snapshot === null || !sameChange(snapshot.item, gate.item)) return ['head_mismatch'];
  const outcome = shipRule(
    assembleShipInput({
      facts: snapshot.facts,
      item: gate.item,
      area: gate.harness.jdArea,
      approver: gate.approver,
      at: gate.context.at,
      override: decision === 'override',
    }),
  );
  return outcome.verdict === 'advance' ? [] : outcome.reasons;
}

export async function shipRefusal(
  tx: StoreTransaction,
  gate: ShipGate,
  decision: GateDecision,
  snapshot: ShipSnapshot | null,
): Promise<Refused | null> {
  const reasons = shipReasons(gate, decision, snapshot);
  const [first] = reasons;
  if (first === undefined) return null;
  const stage = gate.stage.key;
  await recordItemEvents(tx, gate.context, gate.item.itemId, [
    draft('ship_refused', { stage, reasons: [...reasons] }),
  ]);
  return refused(first, { stage, reasons });
}

export async function exitAfterDecision(
  ports: ShipPorts,
  pending: PendingExit,
): Promise<{ readonly item: ItemState; readonly advanced: boolean }> {
  const advanced = await exitThroughConnector(ports, pending.context, pending);
  const now = await ports.store.transaction((tx) => tx.harnessItems.read.byId(pending.item.itemId));
  return { item: now ?? pending.item, advanced };
}
