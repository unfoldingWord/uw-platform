import type {
  GateDecision,
  Harness,
  ItemState,
  Principal,
  ShipRefusal,
  Stage,
} from '@uw/contracts';
import { draft, recordItemEvents, type RecordContext } from '../items/record.ts';
import { resolveExit } from '../items/transitions.ts';
import { refused, type Refused } from '../outcome.ts';
import { PortNotWiredError } from '../port-errors.ts';
import type { Ports, PullRequestFacts, StoreTransaction } from '../ports.ts';
import { shipRule } from '../ship-rule.ts';
import { exitThroughConnector } from './exit.ts';
import { assembleShipInput } from './ship-input.ts';

type ShipPorts = Pick<Ports, 'connectors' | 'githubFacts' | 'store'>;

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
  readonly next: Stage | null;
  readonly overrideReason: string | null;
  readonly context: RecordContext;
};

const shipDecisions: ReadonlySet<GateDecision> = new Set<GateDecision>(['approve', 'override']);

async function itemAtConnectorExit(
  tx: StoreTransaction,
  itemId: string,
): Promise<ItemState | null> {
  const item = await tx.harnessItems.read.byId(itemId);
  if (item === null || item.gateStatus !== 'parked') return null;
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  const stage = stages.find((entry) => entry.key === item.stageKey);
  if (stage === undefined || stage.connector === 'none') return null;
  if (item.gateTarget === null) return item;
  return resolveExit(stages, stage, item.gateTarget)?.kind === 'forward' ? item : null;
}

export async function readShipFacts(
  ports: ShipPorts,
  itemId: string,
  decision: GateDecision,
): Promise<ShipSnapshot | Refused | null> {
  if (!shipDecisions.has(decision)) return null;
  const item = await ports.store.transaction((tx) => itemAtConnectorExit(tx, itemId));
  if (item === null) return null;
  if (item.pullRequest === null) return { item, facts: null };
  try {
    return { item, facts: await ports.githubFacts.pullRequest(item.pullRequest) };
  } catch (error) {
    if (error instanceof PortNotWiredError) return refused('not_wired', { port: error.port });
    throw error;
  }
}

function sameChange(before: ItemState, after: ItemState): boolean {
  const [was, now] = [before.pullRequest, after.pullRequest];
  const samePullRequest =
    was === null || now === null ? was === now : was.repo === now.repo && was.number === now.number;
  return samePullRequest && before.expectedHead === after.expectedHead;
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
