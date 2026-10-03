import type { ItemState, RunHibernation } from '@uw/contracts';
import { draft, recordItemEvents } from '../items/record.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { currentLevel } from './breaker-level.ts';

type SuspendPorts = Pick<Ports, 'clock' | 'ids' | 'store' | 'runs'>;

type RunSelect = (tx: StoreTransaction) => Promise<readonly RunRow[]>;

export async function underPause(tx: StoreTransaction, item: ItemState): Promise<boolean> {
  const harness = await tx.harnesses.read.byId(item.harnessId);
  if (harness === null || harness.paused) return true;
  const stages = await tx.harnessStages.read.forHarness(item.harnessId);
  return stages.some((stage) => stage.key === item.stageKey && stage.paused);
}

async function stillHeld(tx: StoreTransaction, item: ItemState, why: RunHibernation) {
  if (why === 'paused') return underPause(tx, item);
  if (why === 'breaker') return (await currentLevel(tx)) === 'pausing';
  return true;
}

async function hibernateOne(
  ports: SuspendPorts,
  runId: string,
  why: RunHibernation,
): Promise<boolean> {
  return ports.store.transaction(async (tx) => {
    const seen = await tx.harnessRuns.read.byId(runId);
    if (seen === null) return false;
    const item = await tx.harnessItems.read.lock(seen.itemId);
    const run = await tx.harnessRuns.read.lock(runId);
    if (item === null || run === null) return false;
    if (run.outcome !== 'running' || run.runShape !== 'workflow-run') return false;
    if (!(await stillHeld(tx, item, why))) return false;
    await tx.harnessRuns.write.update({ ...run, outcome: 'hibernated', hibernatedFor: why });
    const context = {
      actor: run.persona,
      at: ports.clock.now(),
      traceId: run.traceId,
      requestId: null,
      ids: ports.ids,
    };
    await recordItemEvents(tx, context, item.itemId, [draft('run_hibernated', { runId, why })]);
    return true;
  });
}

async function sleep(ports: SuspendPorts, runId: string): Promise<void> {
  try {
    await ports.runs.hibernate(runId);
  } catch {
    return;
  }
}

export async function hibernateRunsWhere(
  ports: SuspendPorts,
  select: RunSelect,
  why: RunHibernation,
): Promise<readonly string[]> {
  const chosen = await ports.store.transaction(select);
  const hibernated: string[] = [];
  for (const run of [...chosen].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!(await hibernateOne(ports, run.id, why))) continue;
    hibernated.push(run.id);
    await sleep(ports, run.id);
  }
  return hibernated;
}
