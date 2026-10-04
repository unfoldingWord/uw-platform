import { createDelegationCommands, type DelegationCommands } from './delegations/commands.ts';
import { createGateCommands, type GateCommands } from './gates/commands.ts';
import { wakingGrants, wakingStore } from './hub-wakes.ts';
import { createEventReads, type EventReads } from './items/events.ts';
import { createItemCommands, type ItemCommands } from './items/commands.ts';
import { replay } from './items/fold.ts';
import { createRepairCommands, type RepairCommands } from './items/repair.ts';
import { createMeasurementCommands, type MeasurementCommands } from './measurements/commands.ts';
import { createPersonaCommands, type PersonaCommands } from './personas/commands.ts';
import type { Ports } from './ports.ts';
import { notifyCommitted, type AfterCommit } from './notify/after-commit.ts';
import { createKernelReads, type KernelReads } from './reads/index.ts';
import { createBreakerCommands, type BreakerCommands } from './runs/breaker.ts';
import { createRunCommands, type RunCommands } from './runs/commands.ts';
import { createStageCommands, type StageCommands } from './stages/commands.ts';
import { templateProperty } from './template-property.ts';
import { createViewReads, type ViewReads } from './views/index.ts';
import { walk, type WalkPath, type WalkStage } from './walk.ts';

export type KernelHealth = { readonly now: Date; readonly appliedMigrations: readonly number[] };

export type Kernel = {
  readonly walk: (stages: readonly WalkStage[]) => WalkPath[];
  readonly templateProperty: typeof templateProperty;
  readonly replay: typeof replay;
  readonly events: EventReads;
  readonly reads: KernelReads;
  readonly views: ViewReads;
  readonly items: ItemCommands;
  readonly repair: RepairCommands;
  readonly stages: StageCommands;
  readonly delegations: DelegationCommands;
  readonly gates: GateCommands;
  readonly personas: PersonaCommands;
  readonly measurements: MeasurementCommands;
  readonly runs: RunCommands;
  readonly breaker: BreakerCommands;
  readonly health: () => Promise<KernelHealth>;
};

function livePorts(ports: Ports): Ports {
  const wiring: { notify: AfterCommit } = { notify: async () => undefined };
  const live: Ports = {
    ...ports,
    store: wakingStore(ports.store, ports.hub, (events) => wiring.notify(events)),
    grants: wakingGrants(ports.grants),
  };
  wiring.notify = notifyCommitted(live);
  return live;
}

export function createKernel(ports: Ports): Kernel {
  const live = livePorts(ports);
  return {
    walk,
    templateProperty,
    replay,
    events: createEventReads(live),
    reads: createKernelReads(live),
    views: createViewReads(live),
    items: createItemCommands(live),
    repair: createRepairCommands(live),
    stages: createStageCommands(live),
    delegations: createDelegationCommands(live),
    gates: createGateCommands(live),
    personas: createPersonaCommands(live),
    measurements: createMeasurementCommands(live),
    runs: createRunCommands(live),
    breaker: createBreakerCommands(live),
    health: async () => ({
      now: live.clock.now(),
      appliedMigrations: await live.store.appliedMigrations(),
    }),
  };
}
