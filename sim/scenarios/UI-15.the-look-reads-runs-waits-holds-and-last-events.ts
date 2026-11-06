import assert from 'node:assert/strict';
import { DAILY_DAYS } from '@uw/harness';
import { simCaller } from '../fixtures.ts';
import { itemInScope, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { waitingScene } from '../views.ts';

export const scenario = defineScenario({
  id: 'UI-15',
  title:
    "the look's three reads: 30 days of runs and gate waits, the items a person holds, and each item's latest event",
  run: async (world) => {
    const scene = await waitingScene(world);
    const owner = () => simCaller(world, scene.owner);
    const daily = await world.kernel.views.daily(owner(), { harnessId: null });
    assert.deepEqual(daily.length, DAILY_DAYS);
    const itemId = await itemInScope(scene, 'Hold this one');
    value(await world.kernel.items.claim(owner(), { itemId, delegationId: null }));
    const mine = await world.kernel.views.mine(owner());
    const held = mine.rows.some((row) => row.item.itemId === itemId);
    assert.deepEqual(held, true);
    const [latest] = await world.kernel.views.lastEvents(owner(), { itemIds: [itemId] });
    assert.deepEqual(latest?.name, 'item_claimed');
    const today = daily.at(-1);
    return { state: { today, held, latest: latest?.name } };
  },
});
