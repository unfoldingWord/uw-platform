import type { HarnessEvent, ItemState, Principal } from '@uw/contracts';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer } from '@uw/db/test-database';
import {
  readAllEvents,
  replay,
  software,
  type Caller,
  type Clock,
  type KernelOutcome,
} from '@uw/harness';
import { describe, expect, it } from 'vitest';
import { platformStore } from '../ports/store.ts';
import { kernelOn, personOn } from '../testing/kernel.ts';

const connectionCount = 6;
const rounds = 4;
const ianId = '00000000-0000-4000-8000-000000000001';

function caller(actor: Principal): Caller {
  return { actor, traceId: crypto.randomUUID() };
}

function accepted<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

const clock: Clock = { now: () => new Date() };

async function withShared(work: (connections: readonly Database[]) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections = Array.from({ length: connectionCount }, () =>
    createClient(database.connectionString),
  );
  try {
    await work(connections);
  } finally {
    await Promise.all(connections.map((db) => db.$client.end()));
    await database.drop();
  }
}

function connectionAt(connections: readonly Database[], n: number): Database {
  const db = connections[n];
  if (db === undefined) throw new Error(`no connection ${n}`);
  return db;
}

async function openStage(
  connections: readonly Database[],
  ian: Principal,
  round: number,
): Promise<{ readonly harnessId: string; readonly itemIds: readonly string[] }> {
  const kernel = kernelOn(connectionAt(connections, 0), clock);
  const harnessId = crypto.randomUUID();
  accepted(
    await kernel.stages.activate(caller(ian), {
      harnessId,
      harnessKey: `software-${round}`,
      jdArea: '80-89',
      template: software,
      repository: null,
    }),
  );
  const itemIds: string[] = [];
  for (let n = 0; n < connectionCount; n += 1) {
    const item = accepted(
      await kernel.items.enqueue(caller(ian), {
        harnessId,
        title: `Race ${round}.${n}`,
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    itemIds.push(item.itemId);
  }
  return { harnessId, itemIds };
}

function agrees(events: readonly HarnessEvent[], item: ItemState): boolean {
  const own = events.filter((event) => event.itemId === item.itemId);
  return JSON.stringify(replay(own)) === JSON.stringify(item);
}

async function settled(
  connection: Database,
  harnessId: string,
): Promise<{ readonly items: readonly ItemState[]; readonly replayed: boolean }> {
  const store = platformStore(connection);
  return store.transaction(async (tx) => {
    const items = await tx.harnessItems.read.forHarness(harnessId);
    const events = await readAllEvents(tx, harnessId, null);
    const replayed = items.every((item) => agrees(events, item));
    return { items, replayed };
  });
}

async function raceRound(
  connections: readonly Database[],
  ian: Principal,
  round: number,
): Promise<void> {
  const { harnessId, itemIds } = await openStage(connections, ian, round);
  const outcomes = await Promise.all(
    itemIds.map((itemId, n) =>
      kernelOn(connectionAt(connections, n), clock).items.reorder(caller(ian), {
        itemId,
        beforeItemId: itemIds[(n + 1) % itemIds.length] ?? null,
      }),
    ),
  );
  expect(outcomes.map((outcome) => outcome.status)).toEqual(
    Array(connectionCount).fill('accepted'),
  );
  const { items, replayed } = await settled(connectionAt(connections, 0), harnessId);
  const priorities = items.map((item) => item.priority).sort((a, b) => a - b);
  expect(priorities).toEqual(Array.from({ length: connectionCount }, (_, n) => (n + 1) * 10));
  expect(replayed).toBe(true);
}

async function raceRounds(connections: readonly Database[]): Promise<void> {
  const first = connectionAt(connections, 0);
  const ian = await personOn(first, ianId, 'ian.lindsley@unfoldingword.org', clock.now());
  for (let round = 0; round < rounds; round += 1) await raceRound(connections, ian, round);
}

describe.skipIf(!testServer)('DX-6 reorders race on separate connections', () => {
  it('leaves one distinct renumbering of the stage that replay agrees with', () =>
    withShared(raceRounds));
});
