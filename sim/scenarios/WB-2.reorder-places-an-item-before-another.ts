import assert from 'node:assert/strict';
import type { ItemState, Principal } from '@uw/contracts';
import { readAllEvents, replay, software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function value<T>(outcome: KernelOutcome<T>): T {
  assert.equal(outcome.status, 'accepted');
  if (outcome.status !== 'accepted') throw new Error('unreachable');
  return outcome.value;
}

type Stage = { readonly world: World; readonly harnessId: string; readonly admin: Principal };

async function enqueueThree(stage: Stage): Promise<readonly string[]> {
  const caller = simCaller(stage.world, stage.admin);
  const ids: string[] = [];
  for (const title of ['A', 'B', 'C']) {
    const item = value(
      await stage.world.kernel.items.enqueue(caller, {
        harnessId: stage.harnessId,
        title,
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    ids.push(item.itemId);
  }
  return ids;
}

async function order(stage: Stage): Promise<readonly ItemState[]> {
  const caller = simCaller(stage.world, stage.admin);
  return value(
    await stage.world.kernel.reads.inStage(caller, {
      harnessId: stage.harnessId,
      stageKey: 'package',
    }),
  );
}

async function replayedEqualsProjection(stage: Stage, ids: readonly string[]): Promise<void> {
  const { store } = stage.world.adapters;
  const events = await store.transaction((tx) => readAllEvents(tx, stage.harnessId, null));
  for (const id of ids) {
    const projected = await store.transaction((tx) => tx.harnessItems.read.byId(id));
    assert.deepEqual(replay(events.filter((event) => event.itemId === id)), projected);
  }
}

export const scenario = defineScenario({
  id: 'WB-2',
  title:
    "reorder takes the item to place before, never an index, and the stage's order afterwards is the server's",
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const stage = { world, harnessId: harness.id, admin };
    const ids = await enqueueThree(stage);
    const [a, b, c] = ids;
    assert.ok(a !== undefined && b !== undefined && c !== undefined);
    const caller = simCaller(world, admin);
    assert.deepEqual(
      (await order(stage)).map((item) => item.itemId),
      [...ids].sort(),
    );
    const first = value(await world.kernel.items.reorder(caller, { itemId: c, beforeItemId: a }));
    assert.deepEqual(
      first.map((item) => item.itemId),
      [c, a, b],
    );
    assert.deepEqual(
      (await order(stage)).map((item) => item.itemId),
      [c, a, b],
    );
    const last = value(await world.kernel.items.reorder(caller, { itemId: a, beforeItemId: null }));
    assert.deepEqual(
      last.map((item) => item.itemId),
      [c, b, a],
    );
    const events = await world.adapters.store.transaction((tx) =>
      readAllEvents(tx, harness.id, null),
    );
    const reordered = events.filter((event) => event.name === 'item_reordered');
    const named = reordered.filter((event) => event.evidence['before'] !== null);
    assert.deepEqual(
      named.map((event) => [event.itemId, event.evidence['before']]),
      [[c, a]],
    );
    await replayedEqualsProjection(stage, ids);
    return { state: { order: (await order(stage)).map((item) => item.title) } };
  },
});
