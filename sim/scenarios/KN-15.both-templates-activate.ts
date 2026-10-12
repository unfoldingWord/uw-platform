import assert from 'node:assert/strict';
import { bml, software, templateProperty } from '@uw/harness';
import { createSimHarness } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'KN-15',
  title:
    'both templates activate onto real Postgres with eight stages each, and the stored rows pass the template property',
  run: async (world) => {
    const first = await createSimHarness(world, software);
    const second = await createSimHarness(world, bml, { jdArea: '30-39' });
    const connectors = [first, second].map((activated) => {
      assert.equal(activated.stages.length, 8);
      assert.deepEqual(templateProperty(activated.stages), []);
      return activated.stages.find((stage) => stage.key === 'ship')?.connector;
    });
    assert.deepEqual(connectors, ['merge', 'publish']);
    return { state: { harnesses: [first.harness.key, second.harness.key], connectors } };
  },
});
