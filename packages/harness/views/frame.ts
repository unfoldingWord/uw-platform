import type { Harness } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { Ports } from '../ports.ts';
import type { StoreTransaction } from '../store-ports.ts';
import { decidableGates } from './gates.ts';
import { readableHarnesses } from './readable.ts';
import { waitingOn } from './waiting.ts';

type FramePorts = Pick<Ports, 'grants' | 'githubFacts'>;

export type FrameHarness = { readonly harness: Harness; readonly open: number };

export type FrameCounts = {
  readonly harnesses: readonly FrameHarness[];
  readonly waiting: number;
  readonly gatesOpen: number;
  readonly agentsWorking: number;
};

export async function frameCounts(
  ports: FramePorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<FrameCounts> {
  const shown = await readableHarnesses(ports, tx, caller, at);
  const ids = shown.map((harness) => harness.id);
  const open = new Map(
    (await tx.harnessItems.read.openCounts(ids)).map((count) => [count.harnessId, count.open]),
  );
  const readable = new Set(ids);
  const live = await tx.harnessRuns.read.live(null);
  const waiting = await waitingOn(ports, tx, caller, at);
  const gates = await decidableGates(ports, tx, caller, at);
  return {
    harnesses: shown.map((harness) => ({ harness, open: open.get(harness.id) ?? 0 })),
    waiting: waiting.rows.length + waiting.uncounted,
    gatesOpen: gates.rows.length,
    agentsWorking: live.filter((run) => readable.has(run.harnessId)).length,
  };
}
