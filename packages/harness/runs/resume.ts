import type { ItemState, RunHibernation } from '@uw/contracts';
import { draft, recordItemEvents, type RecordContext } from '../items/record.ts';
import type { Ports, RunRow, StoreTransaction } from '../ports.ts';
import { currentLevel } from './breaker-level.ts';
import { underPause } from './suspend.ts';

type ResumePorts = Pick<Ports, 'clock' | 'ids' | 'store' | 'runs'>;

type RunSelect = (tx: StoreTransaction) => Promise<readonly RunRow[]>;

type Locked = { readonly item: ItemState; readonly run: RunRow; readonly context: RecordContext };

async function holdForBreaker(tx: StoreTransaction, locked: Locked): Promise<false> {
  const { item, run, context } = locked;
  if (run.hibernatedFor === 'breaker') return false;
  await tx.harnessRuns.write.update({ ...run, hibernatedFor: 'breaker' });
  await recordItemEvents(tx, context, item.itemId, [
    draft('run_hibernated', { runId: run.id, why: 'breaker' }),
  ]);
  return false;
}

async function wakeIn(tx: StoreTransaction, locked: Locked, why: RunHibernation) {
  const { item, run, context } = locked;
  if (why !== 'gate' && (await underPause(tx, item))) return false;
  if ((await currentLevel(tx)) === 'pausing') return holdForBreaker(tx, locked);
  await tx.harnessRuns.write.update({ ...run, outcome: 'running', hibernatedFor: null });
  await recordItemEvents(tx, context, item.itemId, [draft('run_resumed', { runId: run.id, why })]);
  return true;
}

async function resumeOne(ports: ResumePorts, runId: string, why: RunHibernation): Promise<boolean> {
  return ports.store.transaction(async (tx) => {
    const seen = await tx.harnessRuns.read.byId(runId);
    if (seen === null) return false;
    const item = await tx.harnessItems.read.lock(seen.itemId);
    const run = await tx.harnessRuns.read.lock(runId);
    if (item === null || run === null) return false;
    if (run.outcome !== 'hibernated' || run.hibernatedFor !== why) return false;
    const context = {
      actor: run.persona,
      at: ports.clock.now(),
      traceId: run.traceId,
      requestId: null,
      ids: ports.ids,
    };
    return wakeIn(tx, { item, run, context }, why);
  });
}

async function wake(ports: ResumePorts, runId: string): Promise<void> {
  try {
    await ports.runs.resume(runId);
  } catch {
    return;
  }
}

export async function resumeRunsWhere(
  ports: ResumePorts,
  select: RunSelect,
  why: RunHibernation,
): Promise<readonly string[]> {
  const chosen = await ports.store.transaction(select);
  const resumed: string[] = [];
  for (const run of chosen) {
    if (!(await resumeOne(ports, run.id, why))) continue;
    resumed.push(run.id);
    await wake(ports, run.id);
  }
  return resumed;
}
