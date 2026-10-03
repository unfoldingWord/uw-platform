import type { Database } from '@uw/db/client';
import { createKernel, type Connectors, type Kernel, type Store } from '@uw/harness';
import { readyToShipFacts } from '../github/testing/gate-rig.ts';
import { clock } from '../github/testing/ship-rig.ts';
import { platformPorts } from '../kernel.ts';
import { platformStore } from '../ports/store.ts';

function losingAfterTheConnector(db: Database, ran: () => boolean): Store {
  const real = platformStore(db);
  return {
    transaction: (work) =>
      ran() ? Promise.reject(new Error('the exit was lost')) : real.transaction(work),
    appliedMigrations: () => real.appliedMigrations(),
  };
}

export async function kernelThatLosesTheExit(db: Database, itemId: string): Promise<Kernel> {
  let ran = false;
  const connectors: Connectors = {
    run: async () => {
      ran = true;
      return { outcome: 'succeeded', detail: {} };
    },
    outcomeOf: async () => null,
  };
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel({
    ...platformPorts(handle, clock),
    githubFacts: await readyToShipFacts(db, itemId),
    connectors,
    store: losingAfterTheConnector(db, () => ran),
  });
}
