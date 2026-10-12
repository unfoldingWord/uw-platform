import { setTimeout as pause } from 'node:timers/promises';
import type { Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { lockWaiters } from '@uw/db/store';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import { software, type Caller, type Clock } from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { kernelOn, personOn } from '../testing/kernel.ts';

const ianId = '00000000-0000-4000-8000-000000000001';
const firstId = '00000000-0000-4000-8000-000000008501';
const secondId = '00000000-0000-4000-8000-000000008502';
const instant = new Date();
const clock: Clock = { now: () => instant };

type Connections = {
  readonly blocker: Database;
  readonly one: Database;
  readonly two: Database;
  readonly observer: Database;
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

async function waitersReach(observer: Database, count: number): Promise<void> {
  for (let waited = 0; waited < 3_000; waited += 20) {
    if ((await lockWaiters(observer)) >= count) return;
    await pause(20);
  }
  expect.fail(`fewer than ${count} transactions ever waited on a lock`);
}

function holdEventAppends(blocker: Database, harnessId: string, release: Promise<void>) {
  const held = deferred();
  const done = blocker.$client.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`harness_events:${harnessId}`}, 0))`;
    held.resolve();
    await release;
  });
  return { held: held.promise, done };
}

function activate(
  db: Database,
  ian: Principal,
  harnessId: string,
  harnessKey: string,
  repository: string,
) {
  return kernelOn(db, clock).stages.activate(caller(ian), {
    harnessId,
    harnessKey,
    jdArea: '80-89',
    template: software,
    repository,
  });
}

async function race(connections: Connections) {
  const ian = await personOn(connections.observer, ianId, 'ian@unfoldingword.org', instant);
  const release = deferred();
  const blocking = holdEventAppends(connections.blocker, firstId, release.promise);
  await blocking.held;
  const one = activate(connections.one, ian, firstId, 'software-a', 'unfoldingWord/race');
  let two: ReturnType<typeof activate> | undefined;
  try {
    await waitersReach(connections.observer, 1);
    two = activate(connections.two, ian, secondId, 'software-b', 'UnfoldingWord/RACE');
    await waitersReach(connections.observer, 2);
    release.resolve();
    await blocking.done;
    return await Promise.all([one, two]);
  } finally {
    release.resolve();
    await Promise.allSettled([one, two, blocking.done]);
  }
}

async function recorded(observer: Database) {
  const harnesses = await observer.$client`SELECT id, repository FROM harnesses`;
  const activations = await observer.$client`
    SELECT harness_id FROM harness_events WHERE name = 'template_activated'`;
  return {
    harnesses: harnesses.map((row) => [String(row.id), String(row.repository)]),
    activations: activations.map((row) => String(row.harness_id)),
  };
}

async function withConnections(work: (connections: Connections) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections: Connections = {
    blocker: createClient(database.connectionString),
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

async function oneHarnessPerRepository(connections: Connections): Promise<void> {
  const [first, second] = await race(connections);
  expect(first).toMatchObject({ status: 'accepted', value: { harness: { id: firstId } } });
  expect(second).toEqual({
    status: 'error',
    reason: 'harness_exists',
    detail: { repository: 'UnfoldingWord/RACE' },
  });
  expect(await recorded(connections.observer)).toEqual({
    harnesses: [[firstId, 'unfoldingWord/race']],
    activations: [firstId],
  });
}

describe.skipIf(!testServer)(
  'two activations on one repository at once, on real connections (the GH-6 SECURITY carry)',
  () => {
    it('lets exactly one harness hold a repository that the other names in another case', () =>
      withConnections(oneHarnessPerRepository));
  },
);
