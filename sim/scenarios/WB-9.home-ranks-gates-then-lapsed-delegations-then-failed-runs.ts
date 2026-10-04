import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import { waitingScene } from '../views.ts';

export const scenario = defineScenario({
  id: 'WB-9',
  title:
    'Home ranks the gates a person can decide, then their delegations that lapsed unrenewed, then failed runs on items they ran, and the count is the list',
  run: async (world) => {
    const scene = await waitingScene(world);
    const { rows } = await world.kernel.views.waitingOn(simCaller(world, scene.owner));
    const kinds = rows.map((row) => row.kind);
    assert.deepEqual(kinds, ['gate', 'delegation_lapsed', 'run_failed']);
    return { state: { kinds, count: rows.length } };
  },
});
