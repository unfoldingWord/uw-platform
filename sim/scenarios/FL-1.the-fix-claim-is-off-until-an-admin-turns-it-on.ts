import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { claimFix, fixWorld, offeredTo } from '../fix-claims.ts';
import { reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'FL-1',
  title:
    'the fix claim is off until an admin turns it on: while it is off a reviewed item is never offered to the Builder under a fix delegation and its fix claim is refused; once an admin sets it, the poll offers the item',
  run: async (world) => {
    const scene = await fixWorld(world, { fixClaim: false });
    const offeredWhileOff = (await offeredTo(scene, scene.fixer)).includes(scene.itemId);
    assert.deepEqual(offeredWhileOff, false);
    assert.deepEqual(reasonOf(await claimFix(scene)), 'pickup_not_allowed');
    const admin = simCaller(world, scene.admin);
    value(
      await world.kernel.stages.setFixClaim(admin, { harnessId: scene.harnessId, enabled: true }),
    );
    const offeredWhenOn = (await offeredTo(scene, scene.fixer)).includes(scene.itemId);
    assert.deepEqual(offeredWhenOn, true);
    return { state: { offeredWhileOff, offeredWhenOn } };
  },
});
