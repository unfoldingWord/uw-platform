import assert from 'node:assert/strict';
import { reviewWorld } from '../review-runs.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'RV-3',
  title:
    'a Reviewer persona page with approve_at zero_findings posts request_changes on a verdict the model approved with one theoretical finding',
  run: async (world) => {
    const scene = await reviewWorld(world, { approveAt: 'zero_findings' });
    value(
      await world.kernel.runs.postReview(scene.host, scene.runId, {
        verdict: 'approve',
        findings: [{ text: 'A year of clock skew would break the lease.', weight: 'theoretical' }],
        resolvedProvider: 'deepinfra',
        resolvedModel: 'z-ai/glm-5.3',
      }),
    );
    const verdicts = world.adapters.connectors.reviews().map((one) => one.verdict);
    assert.deepEqual(verdicts, ['request_changes']);
    return { state: { verdicts } };
  },
});
