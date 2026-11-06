import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'UI-18',
  title:
    'a harness activated without a title shows its key; an admin names it, title_set records the change, and the key stays',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    assert.deepEqual(harness.title, harness.key);
    const named = value(
      await world.kernel.stages.setTitle(simCaller(world, admin), {
        harnessId: harness.id,
        title: 'Software',
      }),
    );
    assert.deepEqual(named.harness.title, 'Software');
    assert.deepEqual(named.harness.key, harness.key);
    return { state: { key: named.harness.key, title: named.harness.title } };
  },
});
