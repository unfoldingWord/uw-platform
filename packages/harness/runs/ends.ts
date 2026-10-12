import type { ItemState, RunStop } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import { assertDelegationLive } from '../delegations/live.ts';
import { draft, recordContext, recordItemEvents, type EventDraft } from '../items/record.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { ended, heldByRun } from './rows.ts';

export type RunEnd =
  | { readonly outcome: 'completed'; readonly result: 'submitted'; readonly at: Date }
  | {
      readonly outcome: 'stopped';
      readonly why: Extract<RunStop, 'released' | 'lease_expired' | 'delegation_lapsed'>;
      readonly at: Date;
    };

export type RunEnding = { readonly drafts: readonly EventDraft[]; readonly hosted: string | null };

type LapsePorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'runs'>;

const nothing: RunEnding = { drafts: [], hosted: null };

function endsRun(run: RunRow, item: ItemState, end: RunEnd): boolean {
  const live = run.outcome === 'running' || run.outcome === 'hibernated';
  if (!live || !heldByRun(item, run)) return false;
  return end.outcome === 'stopped' || run.runShape === 'external-run';
}

function endDraft(run: RunRow, end: RunEnd): EventDraft {
  if (end.outcome === 'stopped') return draft('run_stopped', { runId: run.id, why: end.why });
  return draft('run_completed', {
    runId: run.id,
    result: end.result,
    gates: [...run.gates],
    review: null,
  });
}

export async function endRunDrafts(
  tx: StoreTransaction,
  item: ItemState,
  end: RunEnd,
): Promise<RunEnding> {
  const live = await tx.harnessRuns.read.liveForItem(item.itemId);
  if (live === null) return nothing;
  const run = await tx.harnessRuns.read.lock(live.id);
  if (run === null || !endsRun(run, item, end)) return nothing;
  await tx.harnessRuns.write.update(ended(run, { outcome: end.outcome }, end.at));
  const hosted = run.runShape === 'workflow-run' ? run.id : null;
  return { drafts: [endDraft(run, end)], hosted };
}

export async function stopWorkflows(
  ports: Pick<Ports, 'runs'>,
  runIds: readonly (string | null)[],
): Promise<void> {
  for (const runId of runIds) {
    if (runId === null) continue;
    try {
      await ports.runs.stop(runId);
    } catch {
      continue;
    }
  }
}

export async function stopLapsedRun(
  ports: LapsePorts,
  caller: Caller,
  itemId: string,
): Promise<void> {
  const context = recordContext(ports, caller, ports.clock.now());
  const hosted = await ports.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item === null || item.holder !== caller.actor.identity || item.delegationId === null) {
      return null;
    }
    const liveness = await assertDelegationLive(tx, ports, item.delegationId, context.at);
    if (liveness.live) return null;
    const ending = await endRunDrafts(tx, item, {
      outcome: 'stopped',
      why: 'delegation_lapsed',
      at: context.at,
    });
    if (ending.drafts.length === 0) return null;
    await recordItemEvents(tx, context, itemId, [
      ...ending.drafts,
      draft('item_released', { holder: item.holder }),
    ]);
    return ending.hosted;
  });
  await stopWorkflows(ports, [hosted]);
}
