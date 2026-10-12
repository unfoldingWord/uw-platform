import assert from 'node:assert/strict';
import { ProviderMismatchError } from '@uw/harness';
import { reviewWorld } from '../review-runs.ts';
import { itemEvents, itemOf, runOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

async function servedElsewhere(scene: Awaited<ReturnType<typeof reviewWorld>>): Promise<unknown> {
  const { modelEngine } = scene.world.adapters;
  modelEngine.respondNextWith({
    toolCalls: [],
    text: 'ok',
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 2, costMicros: 40, costBasis: 'metered' },
    resolvedProvider: 'together',
    resolvedModel: 'z-ai/glm-5.3',
  });
  try {
    await modelEngine.turn({
      engine: 'openrouter-messages',
      model: 'z-ai/glm-5.3',
      pinnedProvider: 'deepinfra',
      persona: 'agent:reviewer',
      instructions: 'Review the change.',
      tools: [],
      messages: [{ role: 'user', text: 'Review the diff.' }],
      traceId: scene.world.adapters.ids.next(),
    });
  } catch (error) {
    return error;
  }
  return null;
}

export const scenario = defineScenario({
  id: 'HE-4',
  title: 'a review run whose work turn is served by another provider fails and posts no review',
  run: async (world) => {
    const scene = await reviewWorld(world);
    const error = await servedElsewhere(scene);
    assert.ok(error instanceof ProviderMismatchError, 'the work turn did not fail closed');
    value(
      await world.kernel.runs.fail(scene.host, scene.runId, {
        step: 'work',
        why: 'provider_mismatch',
        detail: 'deepinfra/together',
      }),
    );
    assert.deepEqual(world.adapters.connectors.reviews(), []);
    const run = await runOf(world, scene.runId);
    assert.equal(run?.outcome, 'failed');
    assert.equal(run?.failure, 'provider_mismatch');
    const item = await itemOf(world, scene.itemId);
    assert.equal(item?.holder, null);
    const names = (await itemEvents(scene, scene.itemId)).map((event) => event.name).slice(-2);
    assert.deepEqual(names, ['run_failed', 'item_released']);
    return {
      state: { run: { outcome: run?.outcome, failure: run?.failure }, holder: item?.holder },
    };
  },
});
