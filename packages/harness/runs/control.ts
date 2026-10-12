import { deviceOwnerSegment, type Harness, type ItemState, type Principal } from '@uw/contracts';
import { allowed, isAgent } from '../access.ts';
import type { Caller } from '../caller.ts';
import { draft, recordContext, recordItemEvents, type RecordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { ended, heldByRun } from './rows.ts';

type ControlPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'runs'>;

export type StopInput = { readonly itemId: string };

export type PromptInput = { readonly itemId: string; readonly message: string };

type Controlled = {
  readonly item: ItemState;
  readonly run: RunRow;
  readonly context: RecordContext;
};

type Scene = {
  readonly itemId: string;
  readonly actor: Principal;
  readonly harness: Harness;
  readonly at: Date;
};

const PROMPT_LIMIT = 20;
const MESSAGE_LIMIT = 4000;

async function ownerOf(tx: StoreTransaction, run: RunRow): Promise<string | null> {
  if (run.runShape !== 'workflow-run') return deviceOwnerSegment(run.persona);
  if (run.delegationId === null) return null;
  const delegation = await tx.delegations.read.byId(run.delegationId);
  return delegation?.personId ?? null;
}

async function liveRun(tx: StoreTransaction, itemId: string): Promise<RunRow | null> {
  const live = await tx.harnessRuns.read.liveForItem(itemId);
  if (live === null) return null;
  const run = await tx.harnessRuns.read.lock(live.id);
  const stillLive = run?.outcome === 'running' || run?.outcome === 'hibernated';
  return stillLive ? run : null;
}

async function judged(tx: StoreTransaction, scene: Scene): Promise<RunRow | Refused> {
  const { itemId, actor, harness, at } = scene;
  const run = await liveRun(tx, itemId);
  if (run === null) return refused('run_not_found', { itemId });
  if (!allowed(actor, 'write', harness, at)) {
    return refused('not_permitted', { harnessId: harness.id });
  }
  const owns = actor.personId !== null && (await ownerOf(tx, run)) === actor.personId;
  if (owns || allowed(actor, 'admin', harness, at)) return run;
  return refused('not_permitted', { harnessId: harness.id });
}

async function controlled(
  ports: ControlPorts,
  tx: StoreTransaction,
  caller: Caller,
  itemId: string,
): Promise<Controlled | Refused> {
  const at = ports.clock.now();
  const item = await tx.harnessItems.read.lock(itemId);
  if (item === null) return refused('item_not_found', { itemId });
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null) return refused('item_not_found', { itemId });
  const personId = caller.actor.personId;
  const grants = personId === null ? [] : await ports.grants.lockAndReread(tx, personId, at);
  const actor = { ...caller.actor, grants: [...grants] };
  if (!allowed(actor, 'read', harness, at)) return refused('item_not_found', { itemId });
  const judgement = await judged(tx, { itemId, actor, harness, at });
  if ('status' in judgement) return judgement;
  return { item, run: judgement, context: recordContext(ports, caller, at) };
}

function agentRefusal(caller: Caller): Refused | null {
  return isAgent(caller.actor) ? refused('not_permitted', { actor: caller.actor.identity }) : null;
}

async function stopWorkflow(ports: ControlPorts, run: RunRow): Promise<void> {
  if (run.runShape !== 'workflow-run') return;
  try {
    await ports.runs.stop(run.id);
  } catch {
    return;
  }
}

export async function stop(
  ports: ControlPorts,
  caller: Caller,
  input: StopInput,
): Promise<KernelOutcome<RunRow>> {
  const agent = agentRefusal(caller);
  if (agent !== null) return agent;
  const outcome = await ports.store.transaction(async (tx) => {
    const scene = await controlled(ports, tx, caller, input.itemId);
    if ('status' in scene) return scene;
    const { item, run, context } = scene;
    const next = ended(run, { outcome: 'stopped' }, context.at);
    await tx.harnessRuns.write.update(next);
    const released = heldByRun(item, run) ? [draft('item_released', { holder: run.persona })] : [];
    await recordItemEvents(tx, context, item.itemId, [
      draft('run_stopped', { runId: run.id, why: 'stopped_by_person' }),
      ...released,
    ]);
    return accepted(next);
  });
  if (outcome.status === 'accepted') await stopWorkflow(ports, outcome.value);
  return outcome;
}

function messageRefusal(message: string): Refused | null {
  if (message.length >= 1 && message.length <= MESSAGE_LIMIT) return null;
  return refused('malformed_command', { messageLimit: MESSAGE_LIMIT });
}

export async function prompt(
  ports: ControlPorts,
  caller: Caller,
  input: PromptInput,
): Promise<KernelOutcome<RunRow>> {
  const denied = agentRefusal(caller) ?? messageRefusal(input.message);
  if (denied !== null) return denied;
  return ports.store.transaction(async (tx) => {
    const scene = await controlled(ports, tx, caller, input.itemId);
    if ('status' in scene) return scene;
    const { item, run, context } = scene;
    if (run.prompts.length >= PROMPT_LIMIT)
      return refused('not_permitted', { why: 'prompts_full' });
    const next: RunRow = { ...run, prompts: [...run.prompts, input.message] };
    await tx.harnessRuns.write.update(next);
    await recordItemEvents(tx, context, item.itemId, [
      draft('run_prompted', { runId: run.id, message: input.message }),
    ]);
    return accepted(next);
  });
}
