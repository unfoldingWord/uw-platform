import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { claimFix, fixWorld } from '../fix-claims.ts';
import { detailOf, itemEvents, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'FL-2',
  title:
    'a review round with a real finding offers the item once to the Builder under a fix delegation: the first fix claim records fix_claimed, and after it is released the same round is not offered again',
  run: async (world) => {
    const scene = await fixWorld(world);
    const first = (await claimFix(scene)).status;
    assert.equal(first, 'accepted');
    const fixer = simCaller(world, scene.fixer);
    value(
      await world.kernel.items.release(fixer, { itemId: scene.itemId, delegationId: scene.fixId }),
    );
    const again = await claimFix(scene);
    assert.equal(again.status, 'error');
    assert.deepEqual(detailOf(again), {
      stage: 'check',
      capability: 'fix',
      why: 'no_review_round',
    });
    const names = (await itemEvents(scene, scene.itemId)).map((event) => event.name);
    const claimed = names.filter((name) => name === 'fix_claimed').length;
    assert.equal(claimed, 1);
    return { state: { first, second: again.status, claimed } };
  },
});
