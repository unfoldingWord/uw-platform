import type { Harness, ItemState, Principal } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { claimWithin, type Claimed } from '../items/claim.ts';
import { draft, recordContext, recordItemEvents } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { agentRefusal, liveRun, stopWorkflow } from './control.ts';
import { ended, heldByRun } from './rows.ts';

type TakeOverPorts = Pick<Ports, 'clock' | 'githubFacts' | 'grants' | 'ids' | 'store' | 'runs'>;

export type TakeOverInput = { readonly itemId: string };

export type TakenOver = { readonly run: RunRow; readonly claimed: Claimed };

type Standing = {
  readonly item: ItemState;
  readonly harness: Harness;
  readonly actor: Principal;
  readonly run: RunRow;
};

class TakeOverRefused extends Error {
  readonly refusal: Refused;

  constructor(refusal: Refused) {
    super(`the take-over was refused: ${refusal.reason}`);
    this.name = 'TakeOverRefused';
    this.refusal = refusal;
  }
}

async function standing(
  ports: TakeOverPorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
  itemId: string,
): Promise<Standing | Refused> {
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('item_not_found', { itemId });
  const personId = caller.actor.personId;
  const grants = personId === null ? [] : await ports.grants.lockAndReread(tx, personId, at);
  const actor = { ...caller.actor, grants: [...grants] };
  if (!allowed(actor, 'read', harness, at)) return refused('item_not_found', { itemId });
  if (!allowed(actor, 'admin', harness, at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  const run = await liveRun(tx, itemId);
  if (run === null) return refused('run_not_found', { itemId });
  return { item, harness, actor, run };
}

async function takeOverIn(
  ports: TakeOverPorts,
  tx: StoreTransaction,
  caller: Caller,
  input: TakeOverInput,
): Promise<KernelOutcome<TakenOver>> {
  const at = ports.clock.now();
  const scene = await standing(ports, tx, caller, at, input.itemId);
  if ('status' in scene) return scene;
  const { item, run } = scene;
  const next = ended(run, { outcome: 'stopped' }, at);
  await tx.harnessRuns.write.update(next);
  const context = recordContext(ports, caller, at);
  const released = heldByRun(item, run) ? [draft('item_released', { holder: run.persona })] : [];
  await recordItemEvents(tx, context, item.itemId, [
    draft('run_stopped', { runId: run.id, why: 'taken_over' }),
    ...released,
  ]);
  const claiming = { input: { itemId: item.itemId, delegationId: null }, at };
  const taken = await claimWithin(ports, tx, caller, claiming);
  if (taken.status !== 'accepted') throw new TakeOverRefused(taken);
  const recorded = await recordItemEvents(tx, context, item.itemId, taken.value.drafts);
  const claimed: Claimed = {
    item: recorded.item,
    leaseExpiresAt: recorded.item.leaseExpiresAt,
    leaseWarning: false,
    branch: taken.value.branch,
  };
  return accepted({ run: next, claimed });
}

export async function takeOver(
  ports: TakeOverPorts,
  caller: Caller,
  input: TakeOverInput,
): Promise<KernelOutcome<TakenOver>> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  let outcome: KernelOutcome<TakenOver>;
  try {
    outcome = await ports.store.transaction((tx) => takeOverIn(ports, tx, caller, input));
  } catch (error) {
    if (error instanceof TakeOverRefused) return error.refusal;
    throw error;
  }
  if (outcome.status === 'accepted') await stopWorkflow(ports, outcome.value.run);
  return outcome;
}
