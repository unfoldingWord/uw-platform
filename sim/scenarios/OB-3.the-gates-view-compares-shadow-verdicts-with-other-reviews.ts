import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { approveVerdict, joinedFacts, joinedHead, joinedWorld, startReview } from '../joining.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'OB-3',
  title:
    'on a shadow harness the Gates view lists the head with its shadow verdict beside the bench review on the same head, and marks the disagreement',
  run: async (world) => {
    const scene = await joinedWorld(world, { shadow: true });
    world.adapters.githubFacts.given(
      joinedFacts(world, {
        reviews: [
          {
            reviewId: 9400000001,
            reviewer: 'uwreview[bot]',
            commit: joinedHead,
            state: 'changes_requested',
            provider: null,
            findings: ['The form posts twice.'],
            submittedAt: world.adapters.clock.now(),
          },
        ],
      }),
    );
    const runId = await startReview(scene);
    value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
    const comparison = value(
      await world.kernel.views.shadow(simCaller(world, scene.admin), {
        harnessId: scene.harnessId,
      }),
    );
    const [row] = comparison.rows;
    assert.equal(comparison.rows.length, 1);
    assert.equal(row?.head, joinedHead);
    assert.deepEqual(row?.reviewer?.verdict, 'approve');
    assert.deepEqual(row?.github, [{ reviewer: 'uwreview[bot]', state: 'changes_requested' }]);
    assert.equal(row?.disagrees, true);
    assert.notEqual(row?.shadow, null);
    return { state: { rows: comparison.rows.length, disagrees: row?.disagrees ?? null } };
  },
});
