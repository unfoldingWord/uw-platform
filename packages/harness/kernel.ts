import { createDelegationCommands, type DelegationCommands } from './delegations/commands.ts';
import { createEventReads, type EventReads } from './items/events.ts';
import { createItemCommands, type ItemCommands } from './items/commands.ts';
import { replay } from './items/fold.ts';
import { createRepairCommands, type RepairCommands } from './items/repair.ts';
import type { Ports } from './ports.ts';
import { shipRule } from './ship-rule.ts';
import { createStageCommands, type StageCommands } from './stages/commands.ts';
import { templateProperty } from './template-property.ts';
import { walk, type WalkPath, type WalkStage } from './walk.ts';

export type KernelHealth = { readonly now: Date; readonly appliedMigrations: readonly number[] };

export type Kernel = {
  readonly walk: (stages: readonly WalkStage[]) => WalkPath[];
  readonly templateProperty: typeof templateProperty;
  readonly shipRule: typeof shipRule;
  readonly replay: typeof replay;
  readonly events: EventReads;
  readonly items: ItemCommands;
  readonly repair: RepairCommands;
  readonly stages: StageCommands;
  readonly delegations: DelegationCommands;
  readonly health: () => Promise<KernelHealth>;
};

export function createKernel(ports: Ports): Kernel {
  return {
    walk,
    templateProperty,
    shipRule,
    replay,
    events: createEventReads(ports),
    items: createItemCommands(ports),
    repair: createRepairCommands(ports),
    stages: createStageCommands(ports),
    delegations: createDelegationCommands(ports),
    health: async () => ({
      now: ports.clock.now(),
      appliedMigrations: await ports.store.appliedMigrations(),
    }),
  };
}
