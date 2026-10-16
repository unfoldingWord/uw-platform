import assert from 'node:assert/strict';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, startOn, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const theoretical = {
  verdict: 'request_changes' as const,
  findings: [
    { text: 'A year of clock skew would break the lease.', weight: 'theoretical' as const },
  ],
  resolvedProvider: 'deepinfra',
  resolvedModel: 'z-ai/glm-5.3',
};

async function round(scene: ReviewWorld, runId: string | null): Promise<void> {
  const id = runId ?? value(await startOn(scene)).runId;
  value(await scene.world.kernel.runs.postReview(scene.host, id, theoretical));
}

export const scenario = defineScenario({
  id: 'RV-1',
  title:
    'three Reviewer verdicts whose only finding is theoretical are posted with the weight and recorded on each run, and never make a review round: the item is not handed to a person',
  run: async (world) => {
    const scene = await reviewWorld(world, { approveAt: 'no_real_or_plausible' });
    await round(scene, scene.runId);
    await round(scene, null);
    await round(scene, null);
    const posted = world.adapters.connectors.reviews();
    assert.equal(posted.length, 3);
    assert.ok(posted.every((one) => one.body.includes('- theoretical: A year of clock skew')));
    const names = (await itemEvents(scene, scene.itemId)).map((event) => event.name);
    assert.equal(names.filter((name) => name === 'run_completed').length, 3);
    assert.ok(!names.includes('handed_to_person'));
    return { state: { verdicts: posted.map((one) => one.verdict), events: names } };
  },
});
