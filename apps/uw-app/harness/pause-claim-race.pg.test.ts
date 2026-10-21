import { defaultCiChecks } from '@uw/contracts';
import type { Principal, Stage } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { software, type Caller, type Clock, type Kernel, type KernelOutcome } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { awaitBlocked } from '../../../packages/harness/port-contracts/lock-wait.ts';
import { agentOf, kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const instant = new Date();
const clock: Clock = { now: () => instant };

type Connections = {
  readonly actor: Database;
  readonly admin: Database;
  readonly holder: Database;
  readonly observer: Database;
};

type Scene = {
  readonly connections: Connections;
  readonly kernel: Kernel;
  readonly ian: Principal;
  readonly harnessId: string;
  readonly scope: Stage;
  readonly itemId: string;
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>, what: string): T {
  if (outcome.status !== 'accepted') throw new Error(`${what} was refused: ${outcome.reason}`);
  return outcome.value;
}

async function itemAtScope(kernel: Kernel, ian: Principal, harnessId: string): Promise<string> {
  const { itemId } = accepted(
    await kernel.items.enqueue(caller(ian), {
      harnessId,
      title: 'Scope the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
    'enqueue',
  );
  accepted(await kernel.items.claim(caller(ian), { itemId, delegationId: null }), 'claim');
  const change = { itemId, to: null, evidence: {}, change: null };
  accepted(await kernel.items.submit(caller(ian), change), 'submit');
  return itemId;
}

async function sceneOn(connections: Connections): Promise<Scene> {
  const ian = await personOn(connections.actor, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const kernel = kernelOn(connections.actor, clock);
  const harnessId = crypto.randomUUID();
  const { stages } = accepted(
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
  const scope = stages.find((stage) => stage.key === 'scope');
  if (scope === undefined) throw new Error('no scope stage');
  const itemId = await itemAtScope(kernel, ian, harnessId);
  return { connections, kernel, ian, harnessId, scope, itemId };
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    actor: createClient(database.connectionString),
    admin: createClient(database.connectionString),
    holder: createClient(database.connectionString),
    observer: createClient(database.connectionString),
  };
  try {
    await work(await sceneOn(connections));
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

async function claimPausedWhileWaiting(scene: Scene) {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => void (release = resolve));
  let locked = (): void => undefined;
  const stageLocked = new Promise<void>((resolve) => void (locked = resolve));
  const key = `harness-stage-claims:${scene.scope.id}`;
  const holding = scene.connections.holder.$client.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    locked();
    await released;
  });
  await stageLocked;
  const agent = agentOf(scene.ian, 'builder');
  const claim = scene.kernel.items.claim(caller(agent), {
    itemId: scene.itemId,
    delegationId: null,
  });
  await awaitBlocked(() => lockWaiters(scene.connections.observer));
  const pause = await kernelOn(scene.connections.admin, clock).stages.pause(caller(scene.ian), {
    harnessId: scene.harnessId,
    stageKey: null,
  });
  accepted(pause, 'pause');
  release();
  await holding;
  return claim;
}

describe.skipIf(!testServer)('WB-1 DX-6 a pause and an agent claim, on real connections', () => {
  it('refuses an agent claim that waited on the stage-claims lock while the harness was paused', () =>
    inScene(async (scene) => {
      const outcome = await claimPausedWhileWaiting(scene);
      expect(outcome).toMatchObject({
        status: 'error',
        reason: 'not_permitted',
        detail: { why: 'paused', stage: 'scope' },
      });
    }));
});
