import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { createKernel, type Connectors, type Kernel, type Store } from '@uw/harness';
import { createGitHubReads } from '../github/client.ts';
import { fixtureApp } from '../github/testing/app-key.ts';
import { readyToShip } from '../github/testing/gate-rig.ts';
import { clock } from '../github/testing/ship-rig.ts';
import { platformPorts } from '../kernel.ts';
import { platformGitHubFacts } from '../ports/github-facts.ts';
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
  const github = readyToShip(itemId);
  const app = await fixtureApp();
  const logger = createLogger(
    { traceId: crypto.randomUUID(), commit: 'test', route: 'lost', principal: null },
    () => undefined,
  );
  const open = () => createGitHubReads(app, { fetch: github.fetch, now: clock.now });
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
    githubFacts: platformGitHubFacts(db, { open, logger }, clock),
    connectors,
    store: losingAfterTheConnector(db, () => ran),
  });
}
