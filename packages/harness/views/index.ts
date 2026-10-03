import type { Harness } from '@uw/contracts';
import type { Caller } from '../caller.ts';
import type { KernelOutcome } from '../outcome.ts';
import type { Ports, StoreTransaction } from '../ports.ts';
import { readableHarness } from '../reads/scene.ts';
import { boardView } from './board.ts';
import { flowView } from './flow.ts';
import type { BoardInput, BoardView, FlowView } from './types.ts';

type ReadOptions = { readonly at: Date };
type ViewPorts = Pick<Ports, 'clock' | 'grants' | 'store'>;

export type ViewReads = {
  harnesses(caller: Caller, options?: ReadOptions): Promise<readonly Harness[]>;
  flow(
    caller: Caller,
    input: { readonly harnessId: string },
    options?: ReadOptions,
  ): Promise<KernelOutcome<FlowView>>;
  board(
    caller: Caller,
    input: BoardInput,
    options?: ReadOptions,
  ): Promise<KernelOutcome<BoardView>>;
};

function byKey(left: Harness, right: Harness): number {
  if (left.key === right.key) return 0;
  return left.key < right.key ? -1 : 1;
}

async function readable(
  ports: ViewPorts,
  tx: StoreTransaction,
  caller: Caller,
  at: Date,
): Promise<readonly Harness[]> {
  const shown: Harness[] = [];
  for (const harness of await tx.harnesses.read.list()) {
    const read = await readableHarness(ports, tx, caller, harness.id, at);
    if (read !== null) shown.push(read);
  }
  return shown.sort(byKey);
}

export function createViewReads(ports: ViewPorts): ViewReads {
  const instant = (options?: ReadOptions): Date => options?.at ?? ports.clock.now();
  return {
    harnesses: (caller, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => readable(ports, tx, caller, at));
    },
    flow: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => flowView(ports, tx, caller, input.harnessId, at));
    },
    board: (caller, input, options) => {
      const at = instant(options);
      return ports.store.transaction((tx) => boardView(ports, tx, caller, input, at));
    },
  };
}
