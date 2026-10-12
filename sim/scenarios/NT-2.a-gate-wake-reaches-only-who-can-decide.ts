import assert from 'node:assert/strict';
import { gateLink } from '@uw/contracts';
import { defineScenario } from '../scenario.ts';
import { gateScene, parkAtShip, personOf, recipientIds, wakesFor } from '../wakes.ts';

export const scenario = defineScenario({
  id: 'NT-2',
  title:
    'a gate wake names the harness, the reason and a deep link to the gate, and reaches only the people who could decide it: both admins for a standard item, only the org admin for an access-control item',
  run: async (world) => {
    const scene = await gateScene(world);
    const standard = await parkAtShip(scene, 'Show the board');
    const high = await parkAtShip(scene, 'Tighten the access check', ['acl']);
    const gateOf = (itemId: string) =>
      wakesFor(world, itemId).find((wake) => wake.reason === 'gate_waiting');
    const standardWake = gateOf(standard);
    assert.deepEqual(
      recipientIds(standardWake),
      [personOf(scene.ian), personOf(scene.areaAdmin)].toSorted(),
    );
    assert.equal(standardWake?.link, gateLink(scene.harnessId, standard));
    assert.deepEqual(recipientIds(gateOf(high)), [personOf(scene.ian)]);
    return {
      state: {
        standard: recipientIds(standardWake),
        high: recipientIds(gateOf(high)),
        link: standardWake?.link ?? null,
      },
    };
  },
});
