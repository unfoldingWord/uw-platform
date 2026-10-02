import { createEventReads, type EventReads } from './items/events.ts';
import { replay } from './items/fold.ts';
import type { Ports } from './ports.ts';
import { walk, type WalkPath, type WalkStage } from './walk.ts';

export type KernelHealth = { readonly now: Date; readonly appliedMigrations: readonly number[] };

export type Kernel = {
  readonly walk: (stages: readonly WalkStage[]) => WalkPath[];
  readonly replay: typeof replay;
  readonly events: EventReads;
  readonly health: () => Promise<KernelHealth>;
};

export function createKernel(ports: Ports): Kernel {
  return {
    walk,
    replay,
    events: createEventReads(ports),
    health: async () => ({
      now: ports.clock.now(),
      appliedMigrations: await ports.store.appliedMigrations(),
    }),
  };
}
