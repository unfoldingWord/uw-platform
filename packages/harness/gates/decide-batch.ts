import { isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { StoreTransaction } from '../ports.ts';
import { exitAfterDecision, readShipFacts, type ShipSnapshot } from './approve-at-ship.ts';
import {
  decideIn,
  normalised,
  type Committed,
  type Decided,
  type DecideInput,
  type GatePorts,
} from './decide.ts';

export type BatchEntry = {
  readonly itemId: string;
  readonly head: string;
  readonly decision: 'approve' | 'reject';
};
export type BatchInput = { readonly harnessId: string; readonly entries: readonly BatchEntry[] };
export type BatchDecided = { readonly decided: readonly Decided[] };

type Planned = { readonly input: DecideInput; readonly snapshot: ShipSnapshot | null };
type Batch = { readonly caller: Caller; readonly harnessId: string; readonly at: Date };

const BATCH_LIMIT = 50;

class BatchRefused extends Error {
  readonly refusal: Refused;

  constructor(refusal: Refused) {
    super(`the batch was refused: ${refusal.reason}`);
    this.name = 'BatchRefused';
    this.refusal = refusal;
  }
}

function naming(outcome: Refused, itemId: string): Refused {
  return refused(outcome.reason, { ...outcome.detail, itemId });
}

function shapeRefusal(input: BatchInput): Refused | null {
  const ids = input.entries.map((entry) => entry.itemId);
  const fits = ids.length > 0 && ids.length <= BATCH_LIMIT && new Set(ids).size === ids.length;
  return fits ? null : refused('malformed_command', { field: 'entries' });
}

function inputOf(entry: BatchEntry): DecideInput {
  const { itemId, decision, head } = entry;
  return { itemId, decision, reason: null, findings: [], seenHead: head };
}

async function inHarness(ports: GatePorts, batch: Batch, itemId: string): Promise<boolean> {
  const item = await ports.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
  return item !== null && item.harnessId === batch.harnessId;
}

async function planned(
  ports: GatePorts,
  batch: Batch,
  entries: readonly BatchEntry[],
): Promise<readonly Planned[] | Refused> {
  const plans: Planned[] = [];
  for (const entry of [...entries].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    const input = normalised(inputOf(entry));
    if ('status' in input) return naming(input, entry.itemId);
    if (!(await inHarness(ports, batch, entry.itemId))) {
      return refused('item_not_found', { itemId: entry.itemId });
    }
    const request = {
      actor: batch.caller.actor,
      at: batch.at,
      itemId: entry.itemId,
      decision: entry.decision,
    };
    const snapshot = await readShipFacts(ports, request);
    if (snapshot !== null && 'status' in snapshot) return naming(snapshot, entry.itemId);
    plans.push({ input, snapshot });
  }
  return plans;
}

async function oneIn(
  ports: GatePorts,
  tx: StoreTransaction,
  batch: Batch,
  plan: Planned,
): Promise<Committed> {
  const { itemId } = plan.input;
  const item = await tx.harnessItems.read.byId(itemId);
  if (item === null || item.harnessId !== batch.harnessId) {
    throw new BatchRefused(refused('item_not_found', { itemId }));
  }
  const request = {
    caller: batch.caller,
    input: plan.input,
    at: batch.at,
    snapshot: plan.snapshot,
  };
  const outcome = await decideIn(ports, tx, request);
  if (outcome.status !== 'accepted') throw new BatchRefused(naming(outcome, itemId));
  return outcome.value;
}

async function committedAll(
  ports: GatePorts,
  batch: Batch,
  plans: readonly Planned[],
): Promise<readonly Committed[] | Refused> {
  try {
    return await ports.store.transaction(async (tx) => {
      const all: Committed[] = [];
      for (const plan of plans) all.push(await oneIn(ports, tx, batch, plan));
      return all;
    });
  } catch (error) {
    if (error instanceof BatchRefused) return error.refusal;
    throw error;
  }
}

export async function decideGates(
  ports: GatePorts,
  caller: Caller,
  input: BatchInput,
): Promise<KernelOutcome<BatchDecided>> {
  if (isAgent(caller.actor)) return refused('not_permitted', { actor: caller.actor.identity });
  const shape = shapeRefusal(input);
  if (shape !== null) return shape;
  const batch = { caller, harnessId: input.harnessId, at: ports.clock.now() };
  const plans = await planned(ports, batch, input.entries);
  if ('status' in plans) return plans;
  const committed = await committedAll(ports, batch, plans);
  if ('status' in committed) return committed;
  const decided: Decided[] = [];
  for (const { decided: one, pending } of committed) {
    decided.push(pending === null ? one : { ...one, ...(await exitAfterDecision(ports, pending)) });
  }
  return accepted({ decided });
}
