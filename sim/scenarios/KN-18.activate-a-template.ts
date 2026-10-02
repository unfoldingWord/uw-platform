import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller, simIan } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'KN-18',
  title:
    'an org admin activates the software template: eight stage rows, one template_activated event',
  run: async (world) => {
    const { harness, stages } = await createSimHarness(world, software);
    assert.deepEqual(
      stages.map((stage) => [stage.key, stage.position, stage.exitGate, stage.connector]),
      software.stages.map((stage) => [stage.key, stage.position, stage.exitGate, stage.connector]),
    );
    const read = await world.kernel.events.read(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      itemId: null,
      after: 0,
      limit: 100,
    });
    assert.equal(read.status, 'accepted');
    assert.deepEqual(read.status === 'accepted' && read.value.events.map((event) => event.name), [
      'template_activated',
    ]);
    return { state: { harness: harness.key, stages: stages.map((stage) => stage.key) } };
  },
});
