import { createKernel, type Clock, type Kernel, type Ports } from '@uw/harness';
import type { DatabaseHandle } from './database.ts';
import { systemClock } from './ports/clock.ts';
import { connectorsNotWired } from './ports/connectors.not-wired.ts';
import { githubFactsNotWired } from './ports/github-facts.not-wired.ts';
import { platformGrants } from './ports/grants.ts';
import { grantsNotWired } from './ports/grants.not-wired.ts';
import { hubNotWired } from './ports/hub.not-wired.ts';
import { randomIds } from './ports/ids.ts';
import { modelEngineNotWired } from './ports/model-engine.not-wired.ts';
import { notifierNotWired } from './ports/notifier.not-wired.ts';
import { runsNotWired } from './ports/runs.not-wired.ts';
import { platformStore } from './ports/store.ts';
import { storeNotWired } from './ports/store.not-wired.ts';

export function platformPorts(database: DatabaseHandle | null, clock: Clock = systemClock): Ports {
  return {
    clock,
    ids: randomIds,
    store: database ? platformStore(database.db) : storeNotWired,
    grants: database ? platformGrants(database.db) : grantsNotWired,
    githubFacts: githubFactsNotWired,
    connectors: connectorsNotWired,
    modelEngine: modelEngineNotWired,
    hub: hubNotWired,
    notifier: notifierNotWired,
    runs: runsNotWired,
  };
}

export function platformKernel(
  database: DatabaseHandle | null,
  clock: Clock = systemClock,
): Kernel {
  return createKernel(platformPorts(database, clock));
}
