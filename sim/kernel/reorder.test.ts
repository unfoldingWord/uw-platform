import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { afterAll, expect, it } from 'vitest';
import { createSimHarness, simAdvance, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Principal;
  readonly ids: readonly [string, string, string];
};

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const caller = simCaller(world, admin);
    const ids: string[] = [];
    for (const title of ['A', 'B', 'C']) {
      const item = value(
        await world.kernel.items.enqueue(caller, {
          harnessId: harness.id,
          title,
          pageId: null,
          priority: 1,
          due: null,
          delegationId: null,
        }),
      );
      ids.push(item.itemId);
    }
    const [a, b, c] = ids;
    if (a === undefined || b === undefined || c === undefined) throw new Error('no items');
    await work({ world, harnessId: harness.id, admin, ids: [a, b, c] });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

async function priorities(scene: Scene): Promise<readonly number[]> {
  return scene.world.adapters.store.transaction(async (tx) => {
    const items = await tx.harnessItems.read.forHarness(scene.harnessId);
    return scene.ids.map((id) => items.find((item) => item.itemId === id)?.priority ?? -1);
  });
}

async function reorderedCount(scene: Scene): Promise<number> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.filter((event) => event.name === 'item_reordered').length;
}

sceneIt(
  'WB-2 refuses a beforeItemId in another stage as malformed_command and changes no priority',
  async (scene) => {
    const [a, b] = scene.ids;
    const before = await priorities(scene);
    await simAdvance(scene.world, {
      harnessId: scene.harnessId,
      itemId: b,
      worker: scene.admin,
      through: ['package'],
    });
    const moved = await priorities(scene);
    const outcome = await scene.world.kernel.items.reorder(simCaller(scene.world, scene.admin), {
      itemId: a,
      beforeItemId: b,
    });
    expect(reasonOf(outcome)).toBe('malformed_command');
    expect(await priorities(scene)).toEqual(moved);
    expect(moved).toEqual(before);
    expect(await reorderedCount(scene)).toBe(0);
  },
);

sceneIt('WB-2 refuses placing an item before itself as malformed_command', async (scene) => {
  const [a] = scene.ids;
  const outcome = await scene.world.kernel.items.reorder(simCaller(scene.world, scene.admin), {
    itemId: a,
    beforeItemId: a,
  });
  expect(reasonOf(outcome)).toBe('malformed_command');
  expect(await reorderedCount(scene)).toBe(0);
});

sceneIt('WB-2 refuses a viewer not_permitted and an agent not_permitted', async (scene) => {
  const [a, b] = scene.ids;
  const viewer = await simPerson(scene.world, 3, [{ role: 'viewer', ...area }]);
  const editor = await simPerson(scene.world, 4, [{ role: 'editor', ...area }]);
  const input = { itemId: a, beforeItemId: b };
  const asViewer = await scene.world.kernel.items.reorder(simCaller(scene.world, viewer), input);
  const agent = simAgent(editor, 'builder', { interactive: false });
  const asAgent = await scene.world.kernel.items.reorder(simCaller(scene.world, agent), input);
  expect([reasonOf(asViewer), reasonOf(asAgent)]).toEqual(['not_permitted', 'not_permitted']);
  expect(await reorderedCount(scene)).toBe(0);
});

sceneIt(
  'WB-2 answers item_not_found for an item the caller may not read, like a missing one',
  async (scene) => {
    const [a, b] = scene.ids;
    const stranger = await simPerson(scene.world, 5, [
      { role: 'viewer', scopeKind: 'jd_area', scopeArea: '10-19' },
    ]);
    const caller = simCaller(scene.world, stranger);
    const hidden = await scene.world.kernel.items.reorder(caller, { itemId: a, beforeItemId: b });
    const missing = await scene.world.kernel.items.reorder(caller, {
      itemId: '00000000-0000-4000-8000-00000000dead',
      beforeItemId: b,
    });
    expect(reasonOf(hidden)).toBe('item_not_found');
    expect(reasonOf(missing)).toBe('item_not_found');
    expect(await reorderedCount(scene)).toBe(0);
  },
);

sceneIt('WB-2 a reorder that changes nothing appends nothing', async (scene) => {
  const [a, b, c] = scene.ids;
  const caller = simCaller(scene.world, scene.admin);
  value(await scene.world.kernel.items.reorder(caller, { itemId: c, beforeItemId: a }));
  const count = await reorderedCount(scene);
  const again = value(
    await scene.world.kernel.items.reorder(caller, { itemId: c, beforeItemId: a }),
  );
  expect(again.map((item) => item.itemId)).toEqual([c, a, b]);
  expect(await reorderedCount(scene)).toBe(count);
  const wakes = scene.world.adapters.hub.wakes().length;
  value(await scene.world.kernel.items.reorder(caller, { itemId: c, beforeItemId: a }));
  expect(scene.world.adapters.hub.wakes().length).toBe(wakes);
});
