import assert from 'node:assert/strict';
import { rewritePageFrontmatter } from '@uw/db/test-seed';
import { simCaller } from '../fixtures.ts';
import { builderFrontmatter, runOf, runWorld, systemCaller, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'HE-8',
  title:
    'a claude-code-sandbox persona under a delegation is skipped hosted_builder_off by the beat until an admin turns hosted Builder on, and the next beat starts its run',
  run: async (world) => {
    const scene = await runWorld(world);
    await rewritePageFrontmatter(
      world.database.db,
      scene.pageId,
      builderFrontmatter(scene, { engine: 'claude-code-sandbox' }),
    );
    const beat = () => world.kernel.runs.beat(systemCaller(scene), { limit: 10 });
    const off = value(await beat());
    assert.deepEqual(off, {
      started: [],
      skipped: [{ delegationId: scene.delegationId, reason: 'hosted_builder_off' }],
    });
    value(
      await world.kernel.stages.setHostedBuilder(simCaller(world, scene.admin), {
        harnessId: scene.harnessId,
        enabled: true,
      }),
    );
    const on = value(await beat());
    const [started] = on.started;
    assert.ok(started, 'the beat started no run');
    assert.equal(started.engine, 'claude-code-sandbox');
    const run = await runOf(world, started.runId);
    assert.equal(run?.outcome, 'running');
    return {
      state: {
        first: off.skipped.map((entry) => entry.reason),
        second: { engine: started.engine, outcome: run?.outcome },
      },
    };
  },
});
