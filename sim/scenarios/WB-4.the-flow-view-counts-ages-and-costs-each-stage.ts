import assert from 'node:assert/strict';
import { simCaller } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { flowWorld, minute } from '../views.ts';

export const scenario = defineScenario({
  id: 'WB-4',
  title:
    'the Flow view counts each stage open and held items, ages it from its oldest entry and totals its metered cost and subscription tokens apart',
  run: async (world) => {
    const scene = await flowWorld(world);
    const caller = simCaller(world, scene.admin);
    const flow = value(await world.kernel.views.flow(caller, { harnessId: scene.harnessId }));
    const now = world.adapters.clock.now().getTime();
    const stages = flow.stages
      .filter((row) => row.count > 0)
      .map((row) => ({
        stage: row.stage.key,
        count: row.count,
        held: row.held,
        wipLimit: row.stage.wipLimit,
        ageMinutes:
          row.oldestEnteredAt === null ? null : (now - row.oldestEnteredAt.getTime()) / minute,
        meteredMinor: row.cost.meteredMinor,
        subscriptionTokens: row.cost.subscriptionTokens,
      }));
    assert.deepEqual(
      stages.map((row) => row.stage),
      ['package', 'scope'],
    );
    assert.equal(flow.stages.length, 8);
    return { state: { stages } };
  },
});
