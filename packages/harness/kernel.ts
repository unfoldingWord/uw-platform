import type { Ports } from './ports.ts';
import { walk, type WalkPath, type WalkStage } from './walk.ts';

export type KernelHealth = { readonly now: Date; readonly appliedMigrations: readonly number[] };

export type Kernel = {
  readonly walk: (stages: readonly WalkStage[]) => WalkPath[];
  readonly health: () => Promise<KernelHealth>;
};

export function createKernel(ports: Ports): Kernel {
  return {
    walk,
    health: async () => ({
      now: ports.clock.now(),
      appliedMigrations: await ports.store.appliedMigrations(),
    }),
  };
}
