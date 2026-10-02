import assert from 'node:assert/strict';
import { bypassesShip } from '@uw/harness';
import { simCaller, simIan } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'KN-10',
  title:
    'activating a template with a path to an effect that skips the gate is refused, naming the path, and writes no harness',
  run: async (world) => {
    const outcome = await world.kernel.stages.activate(simCaller(world, await simIan(world)), {
      harnessId: world.adapters.ids.next(),
      harnessKey: 'bypass',
      jdArea: '80-89',
      template: bypassesShip,
    });
    assert.equal(outcome.status, 'error');
    assert.equal(outcome.status === 'error' && outcome.reason, 'template_bypasses_gate');
    const detail = outcome.status === 'error' ? outcome.detail : {};
    assert.deepEqual(detail['path'], [
      'package',
      'scope',
      'plan',
      'build',
      'check',
      'ship',
      'hotfix',
    ]);
    assert.equal(detail['effectStage'], 'hotfix');
    const harnesses = await world.adapters.store.transaction((tx) => tx.harnesses.read.list());
    assert.deepEqual(harnesses, []);
    return { state: { path: detail['path'], harnesses: harnesses.length } };
  },
});
