import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { DAILY_DAYS } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simPerson } from '../fixtures.ts';
import { itemInScope, value } from '../runs.ts';
import { waitingScene, type Waiting } from '../views.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Work = (scene: Waiting) => Promise<void>;

async function inScene(work: Work): Promise<void> {
  const world = await createWorld();
  try {
    await work(await waitingScene(world));
  } finally {
    await world.close();
  }
}

const stranger = (scene: Waiting) => simPerson(scene.world, 9, []);

const thirtyDays: Work = async (scene) => {
  const caller = simCaller(scene.world, scene.owner);
  const daily = await scene.world.kernel.views.daily(caller, { harnessId: null });
  expect(daily).toHaveLength(DAILY_DAYS);
  expect(daily.at(-1)).toMatchObject({ runs: 1, gateWaits: 1 });
  expect(new Set(daily.map((point) => point.day)).size).toBe(DAILY_DAYS);
  expect(daily.slice(0, -1).every((point) => point.runs === 0 && point.gateWaits === 0)).toBe(true);
  const one = await scene.world.kernel.views.daily(simCaller(scene.world, scene.owner), {
    harnessId: scene.harnessId,
  });
  expect(one).toEqual(daily);
};

const unreadableIsZero: Work = async (scene) => {
  const caller = simCaller(scene.world, await stranger(scene));
  const daily = await scene.world.kernel.views.daily(caller, { harnessId: scene.harnessId });
  expect(daily.every((point) => point.runs === 0 && point.gateWaits === 0)).toBe(true);
};

const heldAndLatest: Work = async (scene) => {
  const { world } = scene;
  const itemId = await itemInScope(scene, 'Hold this one');
  value(
    await world.kernel.items.claim(simCaller(world, scene.owner), { itemId, delegationId: null }),
  );
  const mine = await world.kernel.views.mine(simCaller(world, scene.owner));
  expect(mine.rows.map((row) => [row.item.itemId, row.harness.id])).toContainEqual([
    itemId,
    scene.harnessId,
  ]);
  expect(mine.capped).toBe(false);
  const editors = await world.kernel.views.mine(simCaller(world, scene.editor));
  expect(editors.rows.map((row) => row.item.itemId)).not.toContain(itemId);
  const latest = await world.kernel.views.lastEvents(simCaller(world, scene.owner), {
    itemIds: [itemId],
  });
  expect(latest.map((event) => [event.itemId, event.name])).toEqual([[itemId, 'item_claimed']]);
  const hidden = await world.kernel.views.lastEvents(simCaller(world, await stranger(scene)), {
    itemIds: [itemId],
  });
  expect(hidden).toEqual([]);
};

describe('UI-15 the reads behind the look', () => {
  it('UI-15 runs and gate waits per day over 30 days, for the platform and for one harness', () =>
    inScene(thirtyDays));
  it('UI-15 a harness the person cannot read counts nothing', () => inScene(unreadableIsZero));
  it('UI-15 the items the viewer holds, and each item latest event, only where readable', () =>
    inScene(heldAndLatest));
});
