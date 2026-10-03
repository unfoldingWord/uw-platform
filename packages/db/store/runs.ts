import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { oneOf } from '../checks.ts';
import { harnessRuns } from '../schema.ts';
import { refusing } from './refusal.ts';
import { toRun } from './rows.ts';
import type { HarnessRunsGateway, RunRow } from './types.ts';

const liveOutcomes = ['running', 'hibernated'];

function mutableColumnsOf(run: RunRow) {
  return {
    resolvedProvider: run.resolvedProvider,
    steps: [...run.steps],
    costMinor: run.costMinor,
    computeMinor: run.computeMinor,
    outcome: run.outcome,
    hibernatedFor: run.hibernatedFor,
    failure: run.failure,
    gates: [...run.gates],
    prompts: [...run.prompts],
    endedAt: run.endedAt,
  };
}

async function runsWhere(executor: AnyExecutor, where: SQL | undefined): Promise<RunRow[]> {
  const rows = await executor.select().from(harnessRuns).where(where).orderBy(asc(harnessRuns.id));
  return rows.map(toRun);
}

async function firstWhere(executor: AnyExecutor, where: SQL | undefined): Promise<RunRow | null> {
  return (await runsWhere(executor, where))[0] ?? null;
}

async function lock(executor: AnyExecutor, runId: string): Promise<RunRow | null> {
  const locked = await executor
    .select({ id: harnessRuns.id })
    .from(harnessRuns)
    .where(eq(harnessRuns.id, runId))
    .for('update');
  if (locked.length === 0) return null;
  return firstWhere(executor, eq(harnessRuns.id, runId));
}

async function update(executor: AnyExecutor, run: RunRow): Promise<boolean> {
  const rows = await executor
    .update(harnessRuns)
    .set(mutableColumnsOf(run))
    .where(eq(harnessRuns.id, run.id))
    .returning({ id: harnessRuns.id });
  return rows.length === 1;
}

export function bindRuns(executor: AnyExecutor): HarnessRunsGateway {
  const live = oneOf(harnessRuns.outcome, liveOutcomes);
  return {
    read: {
      byId: (runId) => firstWhere(executor, eq(harnessRuns.id, runId)),
      lock: (runId) => lock(executor, runId),
      liveForItem: (itemId) => firstWhere(executor, and(eq(harnessRuns.itemId, itemId), live)),
      live: (harnessId) =>
        runsWhere(
          executor,
          and(live, harnessId === null ? undefined : eq(harnessRuns.harnessId, harnessId)),
        ),
    },
    write: {
      insert: (run) =>
        refusing(async () => {
          await executor.insert(harnessRuns).values({
            ...run,
            steps: [...run.steps],
            gates: [...run.gates],
            prompts: [...run.prompts],
          });
        }),
      update: (run) => refusing(() => update(executor, run)),
    },
  };
}
