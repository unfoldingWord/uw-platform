import { ciJobSchema, type ItemState, type Principal, defaultCiChecks } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import {
  notWiredCall,
  software,
  type Caller,
  type Clock,
  type ConnectorOutcome,
  type ConnectorRequest,
  type Connectors,
  type Kernel,
  type KernelOutcome,
  type PullRequestFacts,
  type Store,
} from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { platformStore } from '../ports/store.ts';
import { listForDispatch } from '../testing/dispatch.ts';
import { agentOf, fixedFacts, kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const head = 'a'.repeat(40);
const pullRequest = { repo: 'unfoldingWord/uw-platform', number: 42 };
const instant = new Date();
const decidedClock: Clock = { now: () => instant };
const laterClock: Clock = { now: () => new Date(instant.getTime() + 16 * 60_000) };

type Connections = { readonly one: Database; readonly two: Database; readonly observer: Database };

type Hold = {
  holdNext(): void;
  release(): void;
  readonly held: Promise<void>;
  readonly store: Store;
};

function greenFacts(itemId: string): PullRequestFacts {
  return {
    ref: pullRequest,
    state: 'open',
    draft: false,
    head,
    headRef: `harness/${itemId}`,
    headRepo: pullRequest.repo,
    base: '0'.repeat(40),
    baseRef: 'main',
    defaultBranch: 'main',
    checks: ciJobSchema.options.map((name, index) => ({
      checkId: 9100000001 + index,
      name,
      headSha: head,
      app: 'github-actions',
      conclusion: 'success',
    })),
    reviews: [
      {
        reviewId: 9100000101,
        reviewer: 'uw-reviewer[bot]',
        commit: head,
        state: 'approved',
        provider: 'anthropic',
        findings: [],
        submittedAt: instant,
      },
    ],
    files: { head, base: '0'.repeat(40), paths: ['apps/uw-app/board.tsx'] },
    declaration: {
      closes: [],
      risks: 'none known',
      touches: 'the board',
      riskTier: 'standard',
      riskDomains: [],
    },
    closes: [],
    comparison: {
      head,
      base: '0'.repeat(40),
      behindBy: 0,
      patchId: 'b'.repeat(64),
      commits: [{ sha: head, merge: false, skipCi: false, closes: [] }],
      patchIds: { [head]: 'b'.repeat(64) },
    },
    freshAt: instant,
  };
}

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function passStage(kernel: Kernel, worker: Principal, itemId: string, change: boolean) {
  const as = caller(worker);
  accepted(await kernel.items.claim(as, { itemId, delegationId: null }), 'claim');
  const submitted = await kernel.items.submit(as, {
    itemId,
    to: null,
    evidence: {},
    change: change ? { pullRequest, head } : null,
  });
  return accepted(submitted, 'submit').item;
}

async function parkAtShip(
  db: Database,
  kernel: Kernel,
  ian: Principal,
  harnessId: string,
): Promise<ItemState> {
  accepted(
    await kernel.stages.activate(caller(ian), {
      harnessId,
      harnessKey: 'software',
      jdArea: '80-89',
      template: software,
      repository: 'unfoldingWord/uw-platform',
      requiredChecks: [...defaultCiChecks],
    }),
    'activate',
  );
  await listForDispatch(db, 'unfoldingWord/uw-platform');
  const { itemId } = accepted(
    await kernel.items.enqueue(caller(ian), {
      harnessId,
      title: 'Show the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
    'enqueue',
  );
  const agent = agentOf(ian, 'builder');
  for (const [worker, change] of [
    [ian, false],
    [agent, false],
    [agent, false],
    [agent, true],
    [agent, true],
  ] as const) {
    await passStage(kernel, worker, itemId, change);
  }
  return passStage(kernel, ian, itemId, false);
}

type Script = {
  readonly merges: boolean;
  readonly answer: ConnectorOutcome;
  readonly onRun?: () => Promise<void>;
};

function scriptedConnectors(script: Script): Connectors {
  const merged = new Set<string>();
  const keyOf = (request: ConnectorRequest) => `${request.itemId}@${request.expectedHead}`;
  return {
    run: async (request) => {
      if (script.merges) merged.add(keyOf(request));
      await script.onRun?.();
      return script.answer;
    },
    outcomeOf: async (request) =>
      merged.has(keyOf(request)) ? { outcome: 'succeeded', detail: {} } : null,
    review: () => notWiredCall('connectors', 'review'),
  };
}

const succeeded: ConnectorOutcome = { outcome: 'succeeded', detail: {} };
const refusedMerge: ConnectorOutcome = { outcome: 'refused', reason: 'head_mismatch' };

function holdingStore(db: Database): Hold {
  const store = platformStore(db);
  let holding = false;
  let released: () => void = () => undefined;
  let reached: () => void = () => undefined;
  const waiting = new Promise<void>((resolve) => void (released = resolve));
  const held = new Promise<void>((resolve) => void (reached = resolve));
  return {
    holdNext: () => {
      holding = true;
    },
    release: () => released(),
    held,
    store: {
      transaction: (work) =>
        store.transaction(async (tx) => {
          const holds = holding;
          holding = false;
          const result = await work(tx);
          if (holds) {
            reached();
            await waiting;
          }
          return result;
        }),
      appliedMigrations: () => store.appliedMigrations(),
    },
  };
}

type Race = {
  readonly connections: Connections;
  readonly ian: Principal;
  readonly item: ItemState;
  readonly connectors: Connectors;
};

async function withConnections(work: (connections: Connections) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    one: createClient(database.connectionString),
    two: createClient(database.connectionString),
    observer: createClient(database.connectionString),
  };
  try {
    await work(connections);
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

async function parkedOn(connections: Connections): Promise<Omit<Race, 'connectors'>> {
  const { one } = connections;
  const ian = await personOn(one, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const item = await parkAtShip(one, kernelOn(one, decidedClock), ian, crypto.randomUUID());
  return { connections, ian, item };
}

function approve(kernel: Kernel, race: Omit<Race, 'connectors'>) {
  return kernel.gates.decide(caller(race.ian), {
    itemId: race.item.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: race.item.expectedHead,
  });
}

function deciderOn(
  db: Database,
  race: Omit<Race, 'connectors'>,
  connectors: Connectors,
  store: Store,
) {
  const githubFacts = fixedFacts(greenFacts(race.item.itemId));
  return kernelOn(db, decidedClock, { githubFacts, connectors, store });
}

async function lostOn(connections: Connections, merges: boolean): Promise<Race> {
  const race = await parkedOn(connections);
  const connectors = scriptedConnectors({ merges, answer: succeeded });
  const real = platformStore(connections.one);
  let ran = false;
  const losing: Store = {
    transaction: (work) => (ran ? Promise.reject(new Error('lost')) : real.transaction(work)),
    appliedMigrations: () => real.appliedMigrations(),
  };
  const run: Connectors['run'] = async (request) => {
    const outcome = await connectors.run(request);
    ran = true;
    return outcome;
  };
  const decider = deciderOn(connections.one, race, { ...connectors, run }, losing);
  await expect(approve(decider, race)).rejects.toThrow('lost');
  return { ...race, connectors };
}

function recoverOn(db: Database, race: Race, hold: Hold | null = null) {
  const connectors: Connectors = {
    run: race.connectors.run,
    outcomeOf: async (request) => {
      hold?.holdNext();
      return race.connectors.outcomeOf(request);
    },
    review: race.connectors.review,
  };
  const kernel = kernelOn(db, laterClock, {
    connectors,
    ...(hold === null ? {} : { store: hold.store }),
  });
  return kernel.gates.recoverConnectors(caller(race.ian), { harnessId: race.item.harnessId });
}

async function outcomeEvents(race: Pick<Race, 'connections' | 'item'>): Promise<string[]> {
  const rows = await race.connections.observer.$client`
    SELECT name FROM harness_events WHERE item_id = ${race.item.itemId}
    AND (name IN ('connector_succeeded', 'connector_refused')
      OR (name = 'stage_advanced' AND evidence ->> 'from' = 'ship'))
    ORDER BY position`;
  return rows.map((row) => String(row['name']));
}

function itemCount(outcome: KernelOutcome<{ readonly items: readonly unknown[] }>): number {
  return accepted(outcome, 'recover').items.length;
}

const waitersOn = (race: Pick<Race, 'connections'>) => () => lockWaiters(race.connections.observer);

async function twoRecoveries(connections: Connections, merges: boolean): Promise<string[]> {
  const race = await lostOn(connections, merges);
  const hold = holdingStore(connections.one);
  const first = recoverOn(connections.one, race, hold);
  await hold.held;
  const second = recoverOn(connections.two, race);
  await awaitBlocked(waitersOn(race));
  hold.release();
  expect((await Promise.all([first, second])).map(itemCount)).toEqual([1, 0]);
  return outcomeEvents(race);
}

type Paused = { readonly go: () => void; readonly running: Promise<void> };

function pausedRun(): Paused & { readonly gate: () => Promise<void> } {
  let go: () => void = () => undefined;
  let started: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => void (go = resolve));
  const running = new Promise<void>((resolve) => void (started = resolve));
  const gate = async () => {
    started();
    await opened;
  };
  return { go, running, gate };
}

async function slowExitStarted(connections: Connections, answer: ConnectorOutcome) {
  const parked = await parkedOn(connections);
  const paused = pausedRun();
  const connectors = scriptedConnectors({ merges: false, answer, onRun: paused.gate });
  const hold = holdingStore(connections.one);
  const run: Connectors['run'] = async (request) => {
    const outcome = await connectors.run(request);
    hold.holdNext();
    return outcome;
  };
  const deciding = deciderOn(connections.one, parked, { ...connectors, run }, hold.store);
  const decided = approve(deciding, parked);
  await paused.running;
  return { race: { ...parked, connectors }, paused, hold, decided };
}

async function stageOf(race: Pick<Race, 'connections' | 'item'>): Promise<string> {
  const rows = await race.connections.observer.$client`
    SELECT s.key FROM harness_items i JOIN harness_stages s ON s.id = i.stage_id
    WHERE i.id = ${race.item.itemId}`;
  return String(rows[0]?.['key']);
}

async function recoveryBeforeTheLateExit(connections: Connections): Promise<void> {
  const started = await slowExitStarted(connections, succeeded);
  const { race, paused, decided } = started;
  started.hold.release();
  const hold = holdingStore(connections.two);
  const recovering = recoverOn(connections.two, race, hold);
  await hold.held;
  paused.go();
  await awaitBlocked(waitersOn(race));
  hold.release();
  expect(accepted(await recovering, 'recover').items).toEqual([
    { itemId: race.item.itemId, outcome: 'lost' },
  ]);
  expect(accepted(await decided, 'approve')).toMatchObject({ advanced: false });
  expect(await outcomeEvents(race)).toEqual(['connector_refused']);
  expect(await stageOf(race)).toBe('ship');
}

async function lateExitBeforeTheRecovery(connections: Connections): Promise<void> {
  const { race, paused, hold, decided } = await slowExitStarted(connections, refusedMerge);
  paused.go();
  await hold.held;
  const recovering = recoverOn(connections.two, race);
  await awaitBlocked(waitersOn(race));
  hold.release();
  expect(accepted(await decided, 'approve')).toMatchObject({ advanced: false });
  expect(itemCount(await recovering)).toBe(0);
  expect(await outcomeEvents(race)).toEqual(['connector_refused']);
}

describe.skipIf(!testServer)(
  'GH-6 a recovery racing another recovery or the late exit records one outcome',
  () => {
    it('records one lost result when two recoveries race on two connections', () =>
      withConnections(async (connections) => {
        expect(await twoRecoveries(connections, false)).toEqual(['connector_refused']);
      }));

    it('records one merge and one exit when two recoveries race on two connections', () =>
      withConnections(async (connections) => {
        const events = await twoRecoveries(connections, true);
        expect(events).toEqual(['connector_succeeded', 'stage_advanced']);
      }));

    it('records nothing from the late exit when the recovery holds the item first', () =>
      withConnections(recoveryBeforeTheLateExit));

    it('records nothing from the recovery when the late exit holds the item first', () =>
      withConnections(lateExitBeforeTheRecovery));
  },
);
