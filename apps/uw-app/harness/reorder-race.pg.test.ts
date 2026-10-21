import { defaultCiChecks } from '@uw/contracts';
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
      requiredChecks: [...defaultCiChecks],
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

type Held = {
  readonly ian: Principal;
  readonly harnessId: string;
  readonly itemIds: readonly string[];
};

async function heldStage(connections: readonly Database[]): Promise<Held> {
  const ian = await personOn(
    connectionAt(connections, 0),
    ianId,
    'ian.lindsley@unfoldingword.org',
    clock.now(),
  );
  const { harnessId, itemIds } = await openStage(connections, ian, 0);
  return { ian, harnessId, itemIds };
}

type HeldReorder = Held & {
  readonly hold: string;
  readonly change: (item: ItemState) => ItemState;
  readonly reorder: { readonly itemId: string; readonly beforeItemId: string | null };
};

async function reorderWhileHeld(
  connections: readonly Database[],
  input: HeldReorder,
): Promise<KernelOutcome<readonly ItemState[]>> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => void (release = resolve));
  let locked: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => void (locked = resolve));
  const holder = platformStore(connectionAt(connections, 1)).transaction(async (tx) => {
    const row = await tx.harnessItems.read.lock(input.hold);
    if (row === null) throw new Error('no row to hold');
    locked();
    await gate;
    await tx.harnessItems.write.project(input.change(row));
  });
  await ready;
  const kernel = kernelOn(connectionAt(connections, 2), clock);
  const pending = kernel.items.reorder(caller(input.ian), input.reorder);
  await new Promise((resolve) => setTimeout(resolve, 400));
  release();
  await holder;
  return pending;
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
  expect(items).toHaveLength(connectionCount);
  expect(replayed).toBe(true);
}

async function raceRounds(connections: readonly Database[]): Promise<void> {
  const first = connectionAt(connections, 0);
  const ian = await personOn(first, ianId, 'ian.lindsley@unfoldingword.org', clock.now());
  for (let round = 0; round < rounds; round += 1) await raceRound(connections, ian, round);
}

async function leavesStage(connections: readonly Database[]): Promise<void> {
  const { ian, harnessId, itemIds } = await heldStage(connections);
  const [first, second] = itemIds;
  if (first === undefined || second === undefined) throw new Error('no items');
  const outcome = await reorderWhileHeld(connections, {
    ian,
    harnessId,
    itemIds,
    hold: first,
    change: (item) => ({ ...item, stageKey: 'scope' }),
    reorder: { itemId: first, beforeItemId: second },
  });
  expect(outcome.status === 'error' && outcome.reason).toBe('stale_version');
}

async function entersStage(connections: readonly Database[]): Promise<void> {
  const { ian, harnessId, itemIds } = await heldStage(connections);
  const [first, second] = itemIds;
  if (first === undefined || second === undefined) throw new Error('no items');
  const kernel = kernelOn(connectionAt(connections, 0), clock);
  const entering = accepted(
    await kernel.items.enqueue(caller(ian), {
      harnessId,
      title: 'Entering',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await platformStore(connectionAt(connections, 0)).transaction((tx) =>
    tx.harnessItems.write.project({ ...entering, stageKey: 'scope' }),
  );
  const outcome = await reorderWhileHeld(connections, {
    ian,
    harnessId,
    itemIds,
    hold: first,
    change: () => ({ ...entering, stageKey: 'package' }),
    reorder: { itemId: second, beforeItemId: first },
  });
  const order = accepted(outcome).map((item) => item.itemId);
  expect(order).toHaveLength(itemIds.length + 1);
  expect(order).toContain(entering.itemId);
  expect(order.indexOf(second)).toBe(order.indexOf(first) - 1);
  const { items, replayed } = await settled(connectionAt(connections, 0), harnessId);
  const read = items
    .filter((item) => item.stageKey === 'package')
    .sort((x, y) => y.priority - x.priority || x.itemId.localeCompare(y.itemId))
    .map((item) => item.itemId);
  expect(read).toEqual(order);
  expect(replayed).toBe(true);
}

async function markDone(connection: Database, itemIds: readonly string[]): Promise<void> {
  await platformStore(connection).transaction(async (tx) => {
    for (const itemId of itemIds) {
      const row = await tx.harnessItems.read.lock(itemId);
      if (row === null) throw new Error('no row to finish');
      await tx.harnessItems.write.project({ ...row, gateStatus: 'done' });
    }
  });
}

async function reorderedEvents(connection: Database, harnessId: string) {
  const events = await platformStore(connection).transaction((tx) =>
    readAllEvents(tx, harnessId, null),
  );
  return events.filter((event) => event.name === 'item_reordered');
}

function holdRow(connection: Database, itemId: string) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => void (release = resolve));
  let locked: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => void (locked = resolve));
  const holder = platformStore(connection).transaction(async (tx) => {
    await tx.harnessItems.read.lock(itemId);
    locked();
    await gate;
  });
  return { ready, release, holder };
}

async function reorderPastHeld(
  connections: readonly Database[],
  ian: Principal,
  held: string,
  input: { readonly itemId: string; readonly beforeItemId: string },
) {
  const holding = holdRow(connectionAt(connections, 1), held);
  await holding.ready;
  const kernel = kernelOn(connectionAt(connections, 2), clock);
  const pending = kernel.items.reorder(caller(ian), input);
  const timeout = new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 3000));
  const raced = await Promise.race([pending, timeout]);
  holding.release();
  await holding.holder;
  expect(raced).not.toBe('blocked');
  return accepted(await pending).map((item) => item.itemId);
}

async function skipsDoneRows(connections: readonly Database[]): Promise<void> {
  const { ian, harnessId, itemIds } = await heldStage(connections);
  const done = itemIds.slice(2, 5);
  const open = itemIds.filter((itemId) => !done.includes(itemId)).sort();
  const [top, , bottom] = open;
  const [doneItem] = done;
  if (top === undefined || bottom === undefined || doneItem === undefined)
    throw new Error('no items');
  await markDone(connectionAt(connections, 0), done);
  const order = await reorderPastHeld(connections, ian, doneItem, {
    itemId: bottom,
    beforeItemId: top,
  });
  expect(order).toEqual([bottom, ...open.filter((itemId) => itemId !== bottom)]);
  const reordered = await reorderedEvents(connectionAt(connections, 0), harnessId);
  expect(reordered.map((event) => event.itemId)).toEqual([bottom]);
  const input = { itemId: top, beforeItemId: doneItem };
  const kernel = kernelOn(connectionAt(connections, 0), clock);
  const doneBefore = await kernel.items.reorder(caller(ian), input);
  expect(doneBefore.status === 'error' && doneBefore.reason).toBe('malformed_command');
  const { items } = await settled(connectionAt(connections, 0), harnessId);
  const events = await platformStore(connectionAt(connections, 0)).transaction((tx) =>
    readAllEvents(tx, harnessId, null),
  );
  const openRows = items.filter((item) => open.includes(item.itemId));
  expect(openRows.every((item) => agrees(events, item))).toBe(true);
}

describe.skipIf(!testServer)('reorders race on separate connections', () => {
  it('leaves every reorder accepted and a stage order that replay agrees with', () =>
    withShared(raceRounds));

  it('answers stale_version for an item that leaves the stage while the reorder waits', () =>
    withShared(leavesStage));

  it('places among an item that enters the stage while the reorder waits', () =>
    withShared(entersStage));

  it('a reorder in a lane holding done items locks only the open rows, moves one priority and appends one event', () =>
    withShared(skipsDoneRows));
});
