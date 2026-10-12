import type { ItemState } from '@uw/contracts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import type { Ports, RunRow } from '../ports.ts';

export type RunProgress = { readonly run: RunRow; readonly item: ItemState };

export function runProgress(
  ports: Pick<Ports, 'store'>,
  runId: string,
): Promise<KernelOutcome<RunProgress>> {
  return ports.store.transaction(async (tx) => {
    const run = await tx.harnessRuns.read.byId(runId);
    if (run === null || run.runShape !== 'workflow-run') return refused('run_not_found', { runId });
    const item = await tx.harnessItems.read.byId(run.itemId);
    if (item === null) return refused('run_not_found', { runId });
    return accepted({ run, item });
  });
}
