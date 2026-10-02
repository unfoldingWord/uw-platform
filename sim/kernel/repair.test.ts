import type { Harness, ItemState } from '@uw/contracts';
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
    });
    if (enqueued.status !== 'accepted') throw new Error('the enqueue was refused');
    await work(world, harness, ian, enqueued.value);
  } finally {
    await world.close();
  }
}

function drift(world: World, item: ItemState): Promise<void> {
  return world.adapters.store.transaction((tx) =>
    tx.harnessItems.write.project({ ...item, title: 'drifted' }),
  );
}

function logOf(world: World, harnessId: string, itemId: string) {
  return world.adapters.store.transaction((tx) => readAllEvents(tx, harnessId, itemId));
}

function titleOf(world: World, itemId: string): Promise<string | undefined> {
  return world.adapters.store.transaction(
    async (tx) => (await tx.harnessItems.read.byId(itemId))?.title,
  );
}

describe('KN-4 the repair routine rebuilds a projection from the log', () => {
  it('restores a drifted field, reports it, and finds nothing the second time', () =>
    withItem(async (world, _harness, ian, item) => {
      await drift(world, item);
      const first = await world.kernel.repair.rebuildItem(ian, { itemId: item.itemId });
      expect(first.status === 'accepted' && first.value.repaired).toEqual(['title']);
      expect(await titleOf(world, item.itemId)).toBe('Wire the board');
      const second = await world.kernel.repair.rebuildItem(ian, { itemId: item.itemId });
      expect(second.status === 'accepted' && second.value.repaired).toEqual([]);
    }));

  it('leaves the log unchanged', () =>
    withItem(async (world, harness, ian, item) => {
      const read = () => logOf(world, harness.id, item.itemId);
      const before = await read();
      await drift(world, item);
      await world.kernel.repair.rebuildItem(ian, { itemId: item.itemId });
      expect(await read()).toEqual(before);
    }));

  it('refuses an editor and an unknown item', () =>
    withItem(async (world, _harness, ian, item) => {
      const editor = simCaller(
        world,
        await simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]),
      );
      await drift(world, item);
      const refusedEditor = await world.kernel.repair.rebuildItem(editor, { itemId: item.itemId });
      expect(refusedEditor.status === 'error' && refusedEditor.reason).toBe('not_permitted');
      expect(await titleOf(world, item.itemId)).toBe('drifted');
      const missing = await world.kernel.repair.rebuildItem(ian, {
        itemId: world.adapters.ids.next(),
      });
      expect(missing.status === 'error' && missing.reason).toBe('item_not_found');
    }));
});
