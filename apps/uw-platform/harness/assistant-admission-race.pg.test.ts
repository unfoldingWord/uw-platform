import { setTimeout as pause } from 'node:timers/promises';
import { assistantIdentityOf, identitySchema, type Harness, type Principal } from '@uw/contracts';
import { ingestPrincipal, systemPrincipal } from '@uw/core/principal';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { createDrizzleStore, lockWaiters } from '@uw/db/store';
import { projectSeededPersona, seedPage } from '@uw/db/test-seed';
import {
  assistantPersonaDraft,
  assistantRole,
  createKernel,
  DEFAULT_SPEND_CAP,
  type Caller,
  type Clock,
  type Grants,
  type Kernel,
  type LoopResult,
  type ModelEngine,
} from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { platformPorts } from '../kernel.ts';
import { platformGrants } from '../ports/grants.ts';
import { personOn } from '../testing/kernel.ts';

const rowanId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000008601';
const instant = new Date();
const clock: Clock = { now: () => instant };
const MICROS_PER_MINOR = 10_000;
const result: LoopResult = {
  outcome: 'ended',
  text: 'Nothing is booked.',
  usage: { inputTokens: 10, outputTokens: 2, costMicros: MICROS_PER_MINOR },
  resolvedProvider: null,
  resolvedModel: assistantRole.model,
  toolsCalled: [],
  turns: 1,
};

const quietEngine: ModelEngine = {
  turn: () => Promise.reject(new Error('admission serves no model turn')),
  spend: async (since) => ({ spentMinor: 0, currency: 'USD', since, asOf: instant }),
};

type Connections = { readonly one: Database; readonly two: Database; readonly observer: Database };
type Gate = { readonly grants: Grants; readonly hasArrived: () => boolean };
type Scene = {
  readonly connections: Connections;
  readonly harness: Harness;
  readonly requests: readonly [string, string];
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID(), requestId: null };
}

function kernelOn(db: Database, overrides: { readonly grants?: Grants } = {}): Kernel {
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  return createKernel(
    { ...platformPorts(handle), clock, modelEngine: quietEngine, ...overrides },
    { assistantsArea: '90-99', assistantSpendCapMinor: null },
  );
}

function gated(db: Database, release: Promise<void>): Gate {
  let arrived = false;
  const inner = platformGrants(db);
  return {
    hasArrived: () => arrived,
    grants: {
      resolve: (personId, at) => inner.resolve(personId, at),
      resolveIn: async (tx, personId, at) => {
        arrived = true;
        await release;
        return inner.resolveIn(tx, personId, at);
      },
      lockAndReread: (tx, personId, at) => inner.lockAndReread(tx, personId, at),
      holders: (area, at) => inner.holders(area, at),
    },
  };
}

function accepted<T>(outcome: { status: string; value?: T; reason?: string }): T {
  if (outcome.status !== 'accepted' || outcome.value === undefined) {
    throw new Error(`refused: ${String(outcome.reason)}`);
  }
  return outcome.value;
}

async function personaFor(db: Database, harness: Harness, owner: Principal): Promise<void> {
  const draft = assistantPersonaDraft(harness, owner.identity);
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'active',
    jdArea: harness.jdArea,
    slug: draft.slug,
    title: draft.title,
    bodyMd: draft.bodyMd,
    frontmatter: { ...draft.frontmatter, status: 'active' },
  });
  await projectSeededPersona(db, pageId);
}

async function spentAllButOneTurn(db: Database, harnessId: string): Promise<void> {
  const budget = assistantRole.budget.monthly_minor * MICROS_PER_MINOR;
  const reservation = assistantRole.turnCeilingMinor * MICROS_PER_MINOR;
  await createDrizzleStore(db).transaction((tx) =>
    tx.harnessEvents.write.append([
      {
        eventId: crypto.randomUUID(),
        harnessId,
        itemId: null,
        name: 'assistant_turn_finished',
        at: instant.toISOString(),
        actor: identitySchema.parse(assistantIdentityOf(rowanId)),
        evidence: {
          requestId: crypto.randomUUID(),
          turnId: crypto.randomUUID(),
          outcome: 'ended',
          turns: 1,
          inputTokens: 1,
          outputTokens: 1,
          costMicros: budget - reservation,
          tools: [],
        },
        traceId: crypto.randomUUID(),
        requestId: null,
      },
    ]),
  );
}

async function requestOn(kernel: Kernel, externalId: string): Promise<string> {
  const recorded = accepted(
    await kernel.assistants.recordRequest(caller(ingestPrincipal()), {
      personId: rowanId,
      channel: 'zulip_dm',
      externalId,
      threadKey: 'dm',
      replyAddress: 'zulip:5001',
      receivedAt: instant.toISOString(),
      note: 'What is on today?',
      untrustedParts: [],
    }),
  );
  return recorded.requestId;
}

async function sceneOn(connections: Connections): Promise<Scene> {
  const db = connections.observer;
  const kernel = kernelOn(db);
  const rowan = await personOn(db, rowanId, 'rowan.test@unfoldingword.org', instant);
  const harnessId = crypto.randomUUID();
  const { harness } = accepted(
    await kernel.assistants.provision(caller(rowan), { harnessId, personId: rowanId }),
  );
  await personaFor(db, harness, rowan);
  accepted(
    await kernel.delegations.grant(caller(rowan), {
      harnessId,
      persona: assistantIdentityOf(rowanId),
      capability: 'assist',
      maxTier: null,
      expiresAt: null,
      supersedes: null,
    }),
  );
  accepted(
    await kernel.breaker.check(caller(systemPrincipal()), { ...DEFAULT_SPEND_CAP, since: instant }),
  );
  await spentAllButOneTurn(db, harnessId);
  return {
    connections,
    harness,
    requests: [await requestOn(kernel, '801'), await requestOn(kernel, '802')],
  };
}

async function withScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    one: createClient(database.connectionString),
    two: createClient(database.connectionString),
    observer: createClient(database.connectionString),
  };
  try {
    await work(await sceneOn(connections));
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

async function secondBlocked(scene: Scene, second: Gate): Promise<boolean> {
  for (let waited = 0; waited < 3_000; waited += 20) {
    if (second.hasArrived()) return false;
    if ((await lockWaiters(scene.connections.observer)) > 0) return true;
    await pause(20);
  }
  return expect.fail('the second admission neither waited on a lock nor reached the grants');
}

function beginOn(db: Database, gate: Gate, requestId: string) {
  return kernelOn(db, { grants: gate.grants }).assistants.beginTurn(caller(systemPrincipal()), {
    requestId,
    attemptId: crypto.randomUUID(),
  });
}

async function oneOfTwoAdmitted(scene: Scene): Promise<void> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = gated(scene.connections.one, released);
  const second = gated(scene.connections.two, released);
  const one = beginOn(scene.connections.one, first, scene.requests[0]);
  while (!first.hasArrived()) await pause(10);
  const two = beginOn(scene.connections.two, second, scene.requests[1]);
  try {
    const blocked = await secondBlocked(scene, second);
    release();
    const outcomes = await Promise.all([one, two]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['accepted', 'error']);
    const why = await scene.connections.observer.$client`
      SELECT evidence->>'why' AS why FROM harness_events
      WHERE harness_id = ${scene.harness.id} AND name = 'assistant_turn_refused'`;
    expect(why.map((row) => String(row.why))).toEqual(['assistant_budget_spent']);
    expect(blocked).toBe(true);
  } finally {
    release();
    await Promise.allSettled([one, two]);
  }
}

function settledFlag(work: Promise<unknown>): () => boolean {
  let settled = false;
  void work.finally(() => {
    settled = true;
  });
  return () => settled;
}

async function finishBlocked(scene: Scene, finished: () => boolean): Promise<boolean> {
  for (let waited = 0; waited < 3_000; waited += 20) {
    if (finished()) return false;
    if ((await lockWaiters(scene.connections.observer)) > 0) return true;
    await pause(20);
  }
  return expect.fail('the finishing turn neither waited on a lock nor settled');
}

async function openTurnOn(scene: Scene) {
  const kernel = kernelOn(scene.connections.observer);
  const begun = await kernel.assistants.beginTurn(caller(systemPrincipal()), {
    requestId: scene.requests[0],
    attemptId: crypto.randomUUID(),
  });
  return { turn: accepted(begun), third: await requestOn(kernel, '803') };
}

async function finishWaitsForAdmission(scene: Scene): Promise<void> {
  const { turn, third } = await openTurnOn(scene);
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const admitting = gated(scene.connections.one, released);
  const admission = beginOn(scene.connections.one, admitting, third);
  while (!admitting.hasArrived()) await pause(10);
  const finishing = kernelOn(scene.connections.two).assistants.finishTurn(
    caller(systemPrincipal()),
    { requestId: scene.requests[0], turnId: turn.turnId, result },
  );
  try {
    const blocked = await finishBlocked(scene, settledFlag(finishing));
    release();
    const [admitted, finished] = await Promise.all([admission, finishing]);
    expect([admitted.status, finished.status]).toEqual(['error', 'accepted']);
    expect(blocked).toBe(true);
  } finally {
    release();
    await Promise.allSettled([admission, finishing]);
  }
}

describe.skipIf(!testServer)(
  'PA-3 two requests for one assistant at once, on real connections, with room for one turn',
  () => {
    it('serialises admission on the assistant and admits only one', () =>
      withScene(oneOfTwoAdmitted));

    it('holds a finishing turn until a concurrent admission check has read the month', () =>
      withScene(finishWaitsForAdmission));
  },
);
