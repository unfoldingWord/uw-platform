import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'RV-2',
  title:
    'a person marks one of two Reviewer findings refuted, twice; it is recorded once and the 30-day refute rate on the persona view and in the agent plane reads 1 of 2',
  run: async (world) => {
    const scene = await reviewWorld(world);
    value(
      await world.kernel.runs.postReview(scene.host, scene.runId, {
        verdict: 'request_changes',
        findings: [
          { text: 'The board change drops the empty state.', weight: 'real' },
          { text: 'A year of clock skew breaks the lease.', weight: 'theoretical' },
        ],
        resolvedProvider: 'deepinfra',
        resolvedModel: 'z-ai/glm-5.3',
      }),
    );
    const caller = simCaller(world, scene.admin);
    const input = { itemId: scene.itemId, runId: scene.runId, finding: 1 };
    assert.deepEqual(value(await world.kernel.gates.refuteFinding(caller, input)), {
      recorded: true,
    });
    assert.deepEqual(value(await world.kernel.gates.refuteFinding(caller, input)), {
      recorded: false,
    });
    const dashboard = value(await world.kernel.views.persona(caller, { pageId: scene.pageId }));
    assert.deepEqual(dashboard.refutes, { findings: 2, refuted: 1, capped: false });
    const totals = await world.kernel.views.planeTotals();
    assert.deepEqual(totals.reviewerRefutes.tallies, [
      {
        harnessId: scene.harnessId,
        harnessKey: 'software',
        persona: 'agent:reviewer',
        findings: 2,
        refuted: 1,
      },
    ]);
    return { state: { refutes: dashboard.refutes } };
  },
});
