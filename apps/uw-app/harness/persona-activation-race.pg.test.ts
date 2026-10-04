import { setTimeout as pause } from 'node:timers/promises';
import type { Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { lockWaiters } from '@uw/db/store';
import { seedPage } from '@uw/db/test-seed';
import {
  bml,
  software,
  type ActivatedPersona,
  type Caller,
  type Clock,
  type Grants,
  type KernelOutcome,
} from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { platformGrants } from '../ports/grants.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const pageId = '00000000-0000-4000-8000-000000008401';
const instant = new Date();
const clock: Clock = { now: () => instant };

type Connections = {
  readonly one: Database;
  readonly two: Database;
  readonly observer: Database;
};

type Scene = {
  readonly connections: Connections;
  readonly ian: Principal;
  readonly softwareId: string;
  readonly bmlId: string;
};

type Gate = {
  readonly arrived: Promise<void>;
  readonly grants: Grants;
  readonly hasArrived: () => boolean;
};

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function gated(db: Database, release: Promise<void>): Gate {
  const arrival = deferred();
  let arrived = false;
  const inner = platformGrants(db);
  return {
    arrived: arrival.promise,
    hasArrived: () => arrived,
    grants: {
      resolve: (personId, at) => inner.resolve(personId, at),
      resolveIn: (tx, personId, at) => inner.resolveIn(tx, personId, at),
      lockAndReread: async (tx, personId, at) => {
        const grants = await inner.lockAndReread(tx, personId, at);
        arrived = true;
        arrival.resolve();
        await release;
        return grants;
      },
      holders: (area, at) => inner.holders(area, at),
    },
  };
}

async function harnessOn(db: Database, ian: Principal, key: string, jdArea: string) {
  const template = key === 'bml' ? bml : software;
  const harnessId = crypto.randomUUID();
  const outcome = await kernelOn(db, clock).stages.activate(caller(ian), {
    harnessId,
    harnessKey: key,
    jdArea,
    template,
    repository: null,
  });
  if (outcome.status !== 'accepted') throw new Error(`activating ${key}: ${outcome.reason}`);
  return harnessId;
}

async function sceneOn(connections: Connections): Promise<Scene> {
  const db = connections.observer;
  const ian = await personOn(db, ianId, 'ian.lindsley@unfoldingword.org', instant);
  const softwareId = await harnessOn(db, ian, 'software', '80-89');
  const bmlId = await harnessOn(db, ian, 'bml', '30-39');
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '30-39',
    slug: 'iterate',
    title: 'Iterate',
    bodyMd: 'Iterate tunes a product from its measurements.',
    frontmatter: {
      identity: 'agent:iterate',
      owner: ian.identity,
      harness: bmlId,
      toolset: ['search_pages'],
      run_shape: 'workflow-run',
      engine: 'openrouter-messages',
      model: 'glm-5.3-flash',
      budget: { monthly_minor: 0, currency: 'USD' },
      capability: 'iterate',
      requires_tools: ['summarise_measurements'],
    },
  });
  return { connections, ian, softwareId, bmlId };
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

async function secondBlockedOrArrived(scene: Scene, second: Gate): Promise<boolean> {
  for (let waited = 0; waited < 3_000; waited += 20) {
    if (second.hasArrived()) return false;
    if ((await lockWaiters(scene.connections.observer)) > 0) return true;
    await pause(20);
  }
  return expect.fail('the second activation neither waited on a lock nor reached the grants');
}

function activateOn(
  scene: Scene,
  db: Database,
  gate: Gate,
): Promise<KernelOutcome<ActivatedPersona>> {
  return kernelOn(db, clock, { grants: gate.grants }).personas.activate(caller(scene.ian), {
    pageId,
    expectedVersion: 1,
    harnessId: scene.bmlId,
  });
}

async function concurrentActivations(scene: Scene) {
  const release = deferred();
  const first = gated(scene.connections.one, release.promise);
  const second = gated(scene.connections.two, release.promise);
  const one = activateOn(scene, scene.connections.one, first);
  await first.arrived;
  const two = activateOn(scene, scene.connections.two, second);
  try {
    const blocked = await secondBlockedOrArrived(scene, second);
    release.resolve();
    return { blocked, outcomes: await Promise.all([one, two]) };
  } finally {
    release.resolve();
    await Promise.allSettled([one, two]);
  }
}

async function recorded(scene: Scene) {
  const items = await scene.connections.observer.$client`
    SELECT id FROM harness_items WHERE harness_id = ${scene.softwareId} AND page_id = ${pageId}`;
  const failures = await scene.connections.observer.$client`
    SELECT evidence->>'itemId' AS item_id FROM harness_events
    WHERE harness_id = ${scene.bmlId} AND name = 'persona_activation_failed'`;
  return {
    items: items.map((row) => String(row.id)),
    failures: failures.map((row) => String(row.item_id)),
  };
}

async function oneItemForTwo(scene: Scene): Promise<void> {
  const { blocked, outcomes } = await concurrentActivations(scene);
  expect(outcomes.map((outcome) => outcome.status === 'error' && outcome.reason)).toEqual([
    'unknown_verb',
    'unknown_verb',
  ]);
  const { items, failures } = await recorded(scene);
  expect(items).toHaveLength(1);
  expect(failures).toEqual([items[0], items[0]]);
  expect(blocked).toBe(true);
}

describe.skipIf(!testServer)(
  'AB-8 two activations of one persona at once, on real connections, open exactly one item',
  () => {
    it('serialises the second behind the persona-activation lock, and both name the one item', () =>
      withScene(oneItemForTwo));
  },
);
