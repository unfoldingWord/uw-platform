import {
  createKernel,
  type Clock,
  type Hub,
  type Kernel,
  type ModelEngine,
  type Ports,
} from '@uw/harness';
import type { DatabaseHandle } from './database.ts';
import type { GitHubAccess } from './github/refresh.ts';
import { systemClock } from './ports/clock.ts';
import { platformConnectors, type ShipGitHub } from './ports/connectors.ts';
import { platformGitHubFacts } from './ports/github-facts.ts';
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

type KernelWiring = {
  readonly hub: Hub;
  readonly reads: GitHubAccess | null;
  readonly ship: ShipGitHub | null;
  readonly modelEngine: ModelEngine;
};

type HostWiring = Partial<Pick<KernelWiring, 'modelEngine'>>;

export function hubWiring(hub: Hub, host: HostWiring = {}): KernelWiring {
  return { hub, reads: null, ship: null, modelEngine: modelEngineNotWired, ...host };
}

const idle = hubWiring(hubNotWired);

export function platformPorts(
  database: DatabaseHandle | null,
  clock: Clock = systemClock,
  wiring: KernelWiring = idle,
): Ports {
  return {
    clock,
    ids: randomIds,
    store: database ? platformStore(database.db) : storeNotWired,
    grants: database ? platformGrants(database.db) : grantsNotWired,
    githubFacts: database
      ? platformGitHubFacts(database.db, wiring.reads, clock)
      : githubFactsNotWired,
    connectors: platformConnectors(wiring.ship),
    modelEngine: wiring.modelEngine,
    hub: wiring.hub,
    notifier: notifierNotWired,
    runs: runsNotWired,
  };
}

export function platformKernel(
  database: DatabaseHandle | null,
  clock: Clock = systemClock,
  wiring: KernelWiring = idle,
): Kernel {
  return createKernel(platformPorts(database, clock, wiring));
}
