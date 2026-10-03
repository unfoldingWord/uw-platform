import { createKernel, type Connectors, type Kernel, type Store } from '@uw/harness';
import { unwiredReview } from './adapters/unwired.ts';
import type { World } from './world.ts';

type LostExit = { readonly effectHappened: boolean };

function exitLost(): Error {
  const error = new Error('the exit transaction was lost after the connector ran');
  error.name = 'ExitLost';
  return error;
}

export function kernelThatLosesTheExit(world: World, options: LostExit): Kernel {
  const sim = world.adapters;
  let armed = false;
  const connectors: Connectors = {
    run: async (request) => {
      const outcome = options.effectHappened
        ? await sim.connectors.run(request)
        : { outcome: 'succeeded' as const, detail: {} };
      armed = true;
      return outcome;
    },
    outcomeOf: async () => null,
    review: unwiredReview,
  };
  const store: Store = {
    transaction: (work) => {
      if (!armed) return sim.store.transaction(work);
      armed = false;
      return Promise.reject(exitLost());
    },
    appliedMigrations: () => sim.store.appliedMigrations(),
  };
  return createKernel({ ...sim, connectors, store });
}
