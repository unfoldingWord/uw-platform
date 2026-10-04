import { randomUUID } from 'node:crypto';
import {
  engineSchema,
  principalSchema,
  type Engine,
  type Principal,
  type VerbName,
} from '@uw/contracts';
import { createLogger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import { projectSeededPersona, seedPage } from '@uw/db/test-seed';
import type {
  Caller,
  Connectors,
  GitHubFacts,
  Kernel,
  ModelEngine,
  Notifier,
  PullRequestFacts,
  ReviewRequest,
} from '@uw/harness';
import { DEFAULT_SPEND_CAP } from '@uw/harness';
import type { EngineRegistry } from '../engines/registry.ts';
import type { EngineAdapter, EngineWork, EngineWorkResult } from '../engines/seam.ts';
import { platformRuns } from '../ports/runs.ts';
import type { RunDeps } from '../runs/deps.ts';
import type { Json, StepRunner } from '../runs/step-runner.ts';
import { fakeWorkflowBinding, type FakeWorkflowBinding } from '../runs/testing.ts';
import { accepted, callerOf, enqueued, ian, softwareHarness } from './commands.ts';
import { kernelOn } from './kernel.ts';

type TestClock = { now(): Date; advance(ms: number): void };

export type HostRig = {
  readonly db: Database;
  readonly clock: TestClock;
  readonly kernel: Kernel;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly itemId: string;
  readonly delegationId: string;
  readonly binding: FakeWorkflowBinding;
  readonly reviews: ReviewRequest[];
  facts: PullRequestFacts | null;
  spentMinor: number;
  afterReview: AfterReview;
};

type AfterReview = (request: ReviewRequest, reviewId: number) => Promise<void>;

export type RigOptions = {
  readonly toolset?: readonly VerbName[];
  readonly engine?: Engine;
  readonly provider?: string | null;
  readonly capability?: 'build' | 'review';
  readonly gate?: boolean;
  readonly notifier?: Notifier;
};

const personaPageId = '00000000-0000-4000-8000-000000009901';
const defaultToolset: readonly VerbName[] = [
  'read_page',
  'search_pages',
  'resolve_context',
  'record_run_step',
  'submit_to_gate',
];

const models: ReadonlyMap<string, string> = new Map([
  ['claude-messages', 'claude-sonnet-5'],
  ['openrouter-messages', 'z-ai/glm-5.3'],
  ['claude-code-sandbox', 'claude-sonnet-5'],
  ['codex-sandbox', 'gpt-5.5-codex'],
]);

function clockFrom(start: number): TestClock {
  let current = start;
  return { now: () => new Date(current), advance: (ms) => void (current += ms) };
}

function spendPort(rig: { spentMinor: number }): ModelEngine {
  return {
    turn: () => Promise.reject(new Error('the rig serves no model turn')),
    spend: async (since) => ({
      spentMinor: rig.spentMinor,
      currency: 'USD',
      since,
      asOf: new Date(),
    }),
  };
}

function factsPort(rig: { facts: PullRequestFacts | null }): GitHubFacts {
  return {
    pullRequest: async () => rig.facts,
    refresh: async () => rig.facts,
    diff: async () => ({ kind: 'diff', text: 'diff --git a/x b/x\n', bytes: 19 }),
  };
}

function recordingConnectors(
  reviews: ReviewRequest[],
  rig: { afterReview: AfterReview },
): Connectors {
  return {
    run: async () => ({ outcome: 'refused', reason: 'not_wired' }),
    outcomeOf: async () => ({ outcome: 'refused', reason: 'not_wired' }),
    review: async (request) => {
      reviews.push(request);
      const reviewId = 9500000000 + reviews.length;
      await rig.afterReview(request, reviewId);
      return { outcome: 'posted', reviewId };
    },
  };
}

async function seedPersona(db: Database, harnessId: string, owner: Principal, options: RigOptions) {
  const capability = options.capability ?? 'build';
  await seedPage(db, {
    id: personaPageId,
    type: 'persona',
    status: 'active',
    jdArea: '80-89',
    slug: 'builder',
    title: 'Builder',
    bodyMd: 'Builder turns an approved plan into commits.',
    frontmatter: {
      identity: 'agent:builder',
      owner: owner.identity,
      harness: harnessId,
      toolset: [...(options.toolset ?? defaultToolset)],
      run_shape: 'workflow-run',
      engine: options.engine ?? 'claude-messages',
      model: models.get(options.engine ?? 'claude-messages') ?? 'claude-sonnet-5',
      provider: options.provider ?? null,
      budget: { monthly_minor: 0, currency: 'USD' },
      capability,
      requires_tools: [],
    },
  });
  await projectSeededPersona(db, personaPageId);
}

async function stageFor(kernel: Kernel, admin: Principal, harnessId: string, gate: boolean) {
  const change = gate
    ? { agentPickup: 'allowed' as const, exitGate: 'human_approval' as const }
    : { agentPickup: 'allowed' as const };
  accepted(
    await kernel.stages.updateStage(callerOf(admin), { harnessId, stageKey: 'package', change }),
  );
}

export async function hostRig(
  db: Database,
  host: Caller,
  options: RigOptions = {},
): Promise<HostRig> {
  const clock = clockFrom(Date.now());
  const binding = fakeWorkflowBinding();
  const reviews: ReviewRequest[] = [];
  const holder: { facts: PullRequestFacts | null; spentMinor: number; afterReview: AfterReview } = {
    facts: null,
    spentMinor: 0,
    afterReview: () => Promise.resolve(),
  };
  const kernel = kernelOn(db, clock, {
    modelEngine: spendPort(holder),
    runs: platformRuns(binding),
    githubFacts: factsPort(holder),
    connectors: recordingConnectors(reviews, holder),
    ...(options.notifier === undefined ? {} : { notifier: options.notifier }),
  });
  const { harnessId } = await softwareHarness(db);
  const admin = await ian(db);
  await stageFor(kernel, admin, harnessId, options.gate === true);
  const itemId = await enqueued(db, harnessId, 'Run the hosted Builder');
  const delegation = accepted(
    await kernel.delegations.grant(callerOf(admin), {
      harnessId,
      persona: 'agent:builder',
      capability: options.capability ?? 'build',
      expiresAt: null,
      supersedes: null,
    }),
  );
  await seedPersona(db, harnessId, admin, options);
  const since = clock.now();
  accepted(await kernel.breaker.check(host, { capMinor: 125_000, currency: 'USD', since }));
  return Object.assign(holder, {
    db,
    clock,
    kernel,
    admin,
    harnessId,
    itemId,
    delegationId: delegation.id,
    binding,
    reviews,
  });
}

export function personaPrincipal(rig: HostRig): Principal {
  return principalSchema.parse({
    identity: 'agent:builder',
    kind: 'agent',
    personId: rig.admin.personId,
    email: null,
    grants: [],
    interactive: false,
  });
}

export function startRun(rig: HostRig) {
  return rig.kernel.runs.start(callerOf(personaPrincipal(rig)), {
    itemId: rig.itemId,
    delegationId: rig.delegationId,
    personaPageId,
  });
}

export async function startedRun(rig: HostRig): Promise<string> {
  return accepted(await startRun(rig)).runId;
}

export type Script = (work: EngineWork) => Promise<EngineWorkResult>;

export function scriptedEngines(scripts: Partial<Record<Engine, Script>>): EngineRegistry {
  const adapters = new Map<Engine, EngineAdapter>();
  for (const [name, script] of Object.entries(scripts)) {
    const key = engineSchema.parse(name);
    if (script !== undefined) adapters.set(key, { key, turn: null, work: script });
  }
  return adapters;
}

export function ended(
  text: string | null,
  change: Partial<EngineWorkResult> = {},
): EngineWorkResult {
  return {
    outcome: 'ended',
    text,
    inputTokens: 120,
    outputTokens: 30,
    costMicros: 25_000,
    computeMinor: null,
    resolvedProvider: 'anthropic',
    resolvedModel: 'claude-sonnet-5',
    toolsCalled: [],
    ...change,
  };
}

export function runDepsFor(rig: HostRig, host: Caller, engines: EngineRegistry): RunDeps {
  return {
    verbKernel: rig.kernel,
    runKernel: rig.kernel,
    host,
    db: rig.db,
    commit: 'test-commit',
    cap: DEFAULT_SPEND_CAP,
    logger: createLogger(
      { traceId: randomUUID(), commit: 'test-commit', route: 'workflow', principal: null },
      () => undefined,
    ),
    clock: rig.clock,
    engines,
    scout: { model: 'z-ai/glm-5.3-flash', provider: 'z-ai' },
  };
}

export type FakeSteps = StepRunner & {
  readonly names: string[];
  readonly waits: string[];
  readonly crashed: Promise<void>;
  crashAfter: string | null;
  onWait: (name: string) => Promise<'resumed' | 'timed_out'>;
  beforeStep: (name: string) => Promise<void>;
};

async function attempts<T extends Json>(retries: number, body: () => Promise<T>): Promise<string> {
  let failure: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return JSON.stringify(await body());
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

export function fakeSteps(): FakeSteps {
  const cache = new Map<string, string>();
  let crash = (): void => undefined;
  const crashed = new Promise<void>((resolve) => {
    crash = resolve;
  });
  const steps: FakeSteps = {
    names: [],
    waits: [],
    crashed,
    crashAfter: null,
    onWait: () => Promise.resolve('timed_out'),
    beforeStep: () => Promise.resolve(),
    do: async <T extends Json>(
      name: string,
      config: { retries: number },
      body: () => Promise<T>,
    ) => {
      if (!cache.has(name)) await steps.beforeStep(name);
      const held = cache.get(name) ?? (await attempts(config.retries, body));
      if (!cache.has(name)) {
        cache.set(name, held);
        steps.names.push(name);
      }
      if (steps.crashAfter === name) {
        steps.crashAfter = null;
        crash();
        return new Promise<T>(() => undefined);
      }
      return JSON.parse(held) as T;
    },
    waitForResume: (name) => {
      steps.waits.push(name);
      return steps.onWait(name);
    },
  };
  return steps;
}
