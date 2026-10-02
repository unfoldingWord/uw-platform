import { identitySchema, type Harness, type ItemState } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function withItem(
  work: (world: World, harness: Harness, ian: Caller, item: ItemState) => Promise<void>,
): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const ian = simCaller(world, admin);
    const enqueued = await world.kernel.items.enqueue(ian, {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    });
    if (enqueued.status !== 'accepted') throw new Error('the enqueue was refused');
    await work(world, harness, ian, enqueued.value);
  } finally {
    await world.close();
  }
}

type Case = (world: World, harness: Harness, ian: Caller, item: ItemState) => Promise<void>;

function project(world: World, item: ItemState): Promise<void> {
  return world.adapters.store.transaction((tx) => tx.harnessItems.write.project(item));
}

function drift(world: World, item: ItemState): Promise<void> {
  return world.adapters.store.transaction((tx) =>
    tx.harnessItems.write.project({ ...item, title: 'drifted' }),
  );
}

function logOf(world: World, harnessId: string, itemId: string) {
  return world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, itemId));
}

function rowOf(world: World, itemId: string) {
  return world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
}

function titleOf(world: World, itemId: string): Promise<string | undefined> {
  return world.adapters.store.transaction(
    async (tx) => (await tx.harnessItems.read.byId(itemId))?.title,
  );
}

async function rebuild(world: World, ian: Caller, itemId: string) {
  const outcome = await world.kernel.repair.rebuildItem(ian, { itemId });
  return outcome.status === 'accepted' ? outcome.value.repaired : outcome.reason;
}

const restoresTitle: Case = async (world, _harness, ian, item) => {
  await drift(world, item);
  expect(await rebuild(world, ian, item.itemId)).toEqual(['title']);
  expect(await titleOf(world, item.itemId)).toBe('Wire the board');
  expect(await rebuild(world, ian, item.itemId)).toEqual([]);
};

const keepsTopic: Case = async (world, _harness, ian, item) => {
  await project(world, { ...item, title: 'drifted', zulipTopic: 'topic one' });
  expect(await rebuild(world, ian, item.itemId)).toEqual(['title']);
  expect(await rowOf(world, item.itemId)).toEqual({ ...item, zulipTopic: 'topic one' });
};

const restoresEveryColumn: Case = async (world, _harness, ian, item) => {
  await project(world, {
    ...item,
    stageKey: 'ship',
    holder: identitySchema.parse('agent:builder'),
    claimantKind: 'agent',
    leaseExpiresAt: '2026-10-01T12:00:00.000Z',
    pullRequest: { repo: 'unfoldingWord/uw-platform', number: 9 },
  });
  const repaired = await rebuild(world, ian, item.itemId);
  expect(Array.isArray(repaired) && [...repaired].sort()).toEqual([
    'claimantKind',
    'holder',
    'leaseExpiresAt',
    'pullRequest',
    'stageKey',
  ]);
  expect(await rowOf(world, item.itemId)).toEqual(item);
};

const failsOnEmptyLog: Case = async (world, _harness, ian, item) => {
  const orphan = { ...item, itemId: world.adapters.ids.next() };
  await world.adapters.store.transaction((tx) =>
    tx.harnessItems.write.insert(orphan, world.adapters.clock.now()),
  );
  await expect(rebuild(world, ian, orphan.itemId)).rejects.toThrow(
    'the item has no events to rebuild from',
  );
};

const leavesLog: Case = async (world, harness, ian, item) => {
  const before = await logOf(world, harness.id, item.itemId);
  await drift(world, item);
  await rebuild(world, ian, item.itemId);
  expect(await logOf(world, harness.id, item.itemId)).toEqual(before);
};

const refusesEditor: Case = async (world, _harness, ian, item) => {
  const person = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  await drift(world, item);
  expect(await rebuild(world, simCaller(world, person), item.itemId)).toBe('not_permitted');
  expect(await titleOf(world, item.itemId)).toBe('drifted');
  expect(await rebuild(world, ian, world.adapters.ids.next())).toBe('item_not_found');
};

describe('KN-4 the repair routine rebuilds a projection from the log', () => {
  it('restores a drifted field, reports it, and finds nothing the second time', () =>
    withItem(restoresTitle));
  it('keeps a topic the log cannot rebuild and reports only the drift it can', () =>
    withItem(keepsTopic));
  it('lists every differing field and restores every column', () => withItem(restoresEveryColumn));
  it('fails loudly for a row whose log is empty', () => withItem(failsOnEmptyLog));
  it('leaves the log unchanged', () => withItem(leavesLog));
  it('refuses an editor and an unknown item', () => withItem(refusesEditor));
});
