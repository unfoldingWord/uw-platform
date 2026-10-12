import type { ItemState } from '@uw/contracts';
import type { StoreTransaction } from '../ports.ts';
import { heldByRun } from './rows.ts';

const GATE_LIMIT = 20;

export async function noteGateMet(
  tx: StoreTransaction,
  item: ItemState,
  stageKey: string,
): Promise<void> {
  const live = await tx.harnessRuns.read.liveForItem(item.itemId);
  if (live === null) return;
  const run = await tx.harnessRuns.read.lock(live.id);
  if (run === null || run.outcome !== 'running' || !heldByRun(item, run)) return;
  if (run.gates.includes(stageKey) || run.gates.length >= GATE_LIMIT) return;
  await tx.harnessRuns.write.update({ ...run, gates: [...run.gates, stageKey] });
}
