import assert from 'node:assert/strict';
import { simAdvance, simCaller } from '../fixtures.ts';
import { approveVerdict, joinedHead, joinedPull, joinedWorld, startReview } from '../joining.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'GL-4',
  title:
    'a check-only harness in shadow records the Reviewer verdict and the ship rule verdict, refuses the Ship approval, and calls no GitHub write port method',
  run: async (world) => {
    const scene = await joinedWorld(world, { shadow: true });
    value(await world.kernel.gates.recordShadowVerdicts(scene.ingest, { pullRequest: joinedPull }));
    const runId = await startReview(scene);
    value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
    await simAdvance(world, {
      harnessId: scene.harnessId,
      itemId: scene.itemId,
      worker: scene.admin,
      through: ['check', 'ship'],
    });
    const approve = await world.kernel.gates.decide(simCaller(world, scene.admin), {
      itemId: scene.itemId,
      decision: 'approve',
      reason: null,
      findings: [],
      seenHead: joinedHead,
    });
    assert.equal(approve.status, 'error');
    assert.deepEqual(world.adapters.connectors.calls(), []);
    assert.deepEqual(world.adapters.connectors.reviews(), []);
    return { state: { refused: approve.status === 'error' ? approve.reason : null } };
  },
});
