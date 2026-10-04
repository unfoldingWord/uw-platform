import assert from 'node:assert/strict';
import { planeWorld, seedPlaneLearnings } from '../plane.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'WB-10',
  title:
    'The agent plane counts the metered spend this month apart from subscription tokens, runs today by shape and engine, live delegations, refusals, agent writes and stale learnings',
  run: async (world) => {
    await planeWorld(world);
    await seedPlaneLearnings(world);
    const totals = await world.kernel.views.planeTotals();
    assert.equal(totals.spend.subscriptionTokens, 1200);
    assert.deepEqual(totals.runsToday.byShape, { 'workflow-run': 2, 'external-run': 1 });
    assert.equal(totals.liveDelegations.count, 3);
    assert.equal(totals.staleLearnings.count, 2);
    return {
      state: {
        spend: totals.spend,
        runsToday: totals.runsToday,
        liveDelegations: totals.liveDelegations,
        gateRefusals: totals.gateRefusals,
        agentWrites: totals.agentWrites,
        staleLearnings: totals.staleLearnings,
      },
    };
  },
});
