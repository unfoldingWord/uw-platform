import type { JdArea } from '@uw/contracts';
import { createEmbeddedDatabase, type EmbeddedDatabase } from '@uw/db/embedded';
import {
  createKernel,
  type Grants,
  type Kernel,
  type KernelSettings,
  type Runs,
  type Store,
} from '@uw/harness';
import { createSimClock, type SimClock } from './adapters/clock.ts';
import { createSimConnectors, type SimConnectors } from './adapters/connectors.ts';
import { createSimDirectMessages, type SimDirectMessages } from './adapters/direct-messages.ts';
import { createSimGitHubFacts, type SimGitHubFacts } from './adapters/github-facts.ts';
import { createSimGrants } from './adapters/grants.ts';
import { createSimHub, type SimHub } from './adapters/hub.ts';
import { createSimIds, type SimIds } from './adapters/ids.ts';
import { createSimModelEngine, type SimModelEngine } from './adapters/model-engine.ts';
import { createSimNotifier, type SimNotifier } from './adapters/notifier.ts';
import { createSimPageAppends, type SimPageAppends } from './adapters/page-appends.ts';
import { createSimResearch, type SimResearch } from './adapters/research.ts';
import { createSimRuns } from './adapters/runs.ts';
import { createSimStore } from './adapters/store.ts';
import { createSimWorkspace, type SimWorkspace } from './adapters/workspace.ts';

const worldStart = new Date('2026-10-01T09:00:00.000Z');

export const simAssistantsArea: JdArea = '10-19';
export const simAppOrigin = 'https://platform.sim.example';

const simSettings: KernelSettings = {
  assistantsArea: simAssistantsArea,
  assistantSpendCapMinor: null,
  appOrigin: simAppOrigin,
};

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
  readonly directMessages: SimDirectMessages;
  readonly workspace: SimWorkspace;
  readonly pageAppends: SimPageAppends;
  readonly research: SimResearch;
};

export type World = {
  readonly adapters: SimAdapters;
  readonly database: EmbeddedDatabase;
  readonly kernel: Kernel;
  close(): Promise<void>;
};

function simAdapters(database: EmbeddedDatabase, start: Date): SimAdapters {
  const clock = createSimClock(start);
  return {
    clock,
    ids: createSimIds(),
    store: createSimStore(database),
    grants: createSimGrants(database),
    githubFacts: createSimGitHubFacts(clock),
    connectors: createSimConnectors(),
    modelEngine: createSimModelEngine(clock),
    hub: createSimHub(),
    notifier: createSimNotifier(),
    runs: createSimRuns(),
    directMessages: createSimDirectMessages(clock),
    workspace: createSimWorkspace(),
    pageAppends: createSimPageAppends(() => clock.now()),
    research: createSimResearch(),
  };
}

export async function createWorld(
  start: Date = worldStart,
  settings: Partial<KernelSettings> = {},
): Promise<World> {
  const database = await createEmbeddedDatabase();
  const adapters = simAdapters(database, start);
  return {
    adapters,
    database,
    kernel: createKernel(adapters, { ...simSettings, ...settings }),
    close: () => database.close(),
  };
}
