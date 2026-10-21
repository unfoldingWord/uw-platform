import assert from 'node:assert/strict';
import { claimFix, fixWorld, pushedFix, submitFix } from '../fix-claims.ts';
import { itemOf, reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'FL-3',
  title:
    'a fix that changes more than a quarter of the pull request lines is refused fix_size_cap at submit_to_gate: the claim is released and the expected head stays the reviewed head',
  run: async (world) => {
    const scene = await fixWorld(world);
    value(await claimFix(scene));
    pushedFix(scene, {
      pull: { 'apps/uw-app/board.tsx': 40 },
      fix: { 'apps/uw-app/board.tsx': 11 },
    });
    const reason = reasonOf(await submitFix(scene));
    assert.equal(reason, 'fix_size_cap');
    const item = await itemOf(world, scene.itemId);
    assert.ok(item !== null);
    assert.equal(item.holder, null);
    assert.equal(item.expectedHead, scene.head);
    return { state: { reason, holder: item.holder, expectedHead: item.expectedHead } };
  },
});
