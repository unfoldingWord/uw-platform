import { createEmbeddedDatabase, type EmbeddedDatabase } from '@uw/db/embedded';
import { createKernel, type Grants, type Kernel, type Runs, type Store } from '@uw/harness';
import { createSimClock, type SimClock } from './adapters/clock.ts';
import { createSimConnectors, type SimConnectors } from './adapters/connectors.ts';
import { createSimGitHubFacts, type SimGitHubFacts } from './adapters/github-facts.ts';
import { createSimGrants } from './adapters/grants.ts';
import { createSimHub, type SimHub } from './adapters/hub.ts';
import { createSimIds, type SimIds } from './adapters/ids.ts';
import { createSimModelEngine, type SimModelEngine } from './adapters/model-engine.ts';
import { createSimNotifier, type SimNotifier } from './adapters/notifier.ts';
import { createSimRuns } from './adapters/runs.ts';
import { createSimStore } from './adapters/store.ts';

const worldStart = new Date('2026-10-01T09:00:00.000Z');

type SimAdapters = {
  readonly clock: SimClock;
  readonly ids: SimIds;
  readonly store: Store;
  readonly grants: Grants;
  readonly githubFacts: SimGitHubFacts;
  readonly connectors: SimConnectors;
  readonly modelEngine: SimModelEngine;
  readonly hub: SimHub;
  readonly notifier: SimNotifier;
  readonly runs: Runs;
};

export type World = {
  readonly adapters: SimAdapters;
  readonly database: EmbeddedDatabase;
  readonly kernel: Kernel;
  close(): Promise<void>;
};

function simAdapters(database: EmbeddedDatabase, start: Date): SimAdapters {
  return {
    clock: createSimClock(start),
    ids: createSimIds(),
    store: createSimStore(database),
    grants: createSimGrants(database),
    githubFacts: createSimGitHubFacts(),
    connectors: createSimConnectors(),
    modelEngine: createSimModelEngine(),
    hub: createSimHub(),
    notifier: createSimNotifier(),
    runs: createSimRuns(),
  };
}

export async function createWorld(start: Date = worldStart): Promise<World> {
  const database = await createEmbeddedDatabase();
  const adapters = simAdapters(database, start);
  return { adapters, database, kernel: createKernel(adapters), close: () => database.close() };
}
