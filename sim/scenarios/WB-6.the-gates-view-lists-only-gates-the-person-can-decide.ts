import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { simCaller } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import { gatesWorld, type GatesWorld } from '../views.ts';

async function titlesFor(scene: GatesWorld, actor: Principal): Promise<readonly string[]> {
  const { rows } = await scene.world.kernel.views.gates(simCaller(scene.world, actor));
  return rows.filter((row) => row.stage.key === 'ship').map((row) => row.item.title);
}

export const scenario = defineScenario({
  id: 'WB-6',
  title:
    'the Gates view lists only the gates the person can decide: an area admin sees the standard item, an org admin also the high item touching acl, a viewer none',
  run: async (world) => {
    const scene = await gatesWorld(world);
    const lists = {
      areaAdmin: await titlesFor(scene, scene.areaAdmin),
      orgAdmin: await titlesFor(scene, scene.ian),
      viewer: await titlesFor(scene, scene.viewer),
    };
    assert.deepEqual(lists.areaAdmin, ['Show the board']);
    assert.equal(lists.orgAdmin.length, 2);
    assert.deepEqual(lists.viewer, []);
    return { state: lists };
  },
});
