import { createEventReads, type EventReads } from './items/events.ts';
import { replay } from './items/fold.ts';
import type { Ports } from './ports.ts';
import { createStageCommands, type StageCommands } from './stages/commands.ts';
import { templateProperty } from './template-property.ts';
import { walk, type WalkPath, type WalkStage } from './walk.ts';

export type KernelHealth = { readonly now: Date; readonly appliedMigrations: readonly number[] };

export type Kernel = {
  readonly walk: (stages: readonly WalkStage[]) => WalkPath[];
  readonly templateProperty: typeof templateProperty;
  readonly replay: typeof replay;
  readonly events: EventReads;
  readonly stages: StageCommands;
  readonly health: () => Promise<KernelHealth>;
};

export function createKernel(ports: Ports): Kernel {
  return {
    walk,
    templateProperty,
    replay,
    events: createEventReads(ports),
    stages: createStageCommands(ports),
    health: async () => ({
      now: ports.clock.now(),
      appliedMigrations: await ports.store.appliedMigrations(),
    }),
  };
}
