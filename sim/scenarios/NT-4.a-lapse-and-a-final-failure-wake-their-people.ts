import assert from 'node:assert/strict';
import { homeLink, itemLink } from '@uw/contracts';
import { simCaller } from '../fixtures.ts';
import { runWorld, startOn, systemCaller, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf, recipientIds } from '../wakes.ts';

const failure = { step: 'work' as const, why: 'retries_exhausted' as const, detail: null };

export const scenario = defineScenario({
  id: 'NT-4',
  title:
    'a final run failure wakes the person behind the run at the run-failed rank and links the play-by-play; a lapsed delegation wakes its person at the top rank and links Home',
  run: async (world) => {
    const scene = await runWorld(world);
    const owner = personOf(scene.owner);
    world.adapters.notifier.subscribe(owner);
    const { runId } = value(await startOn(scene));
    value(await world.kernel.runs.fail(systemCaller(scene), runId, failure));
    value(
      await world.kernel.delegations.revoke(simCaller(world, scene.owner), {
        delegationId: scene.delegationId,
      }),
    );
    await world.kernel.delegations.beat(simCaller(world, scene.persona), {
      delegationId: scene.delegationId,
    });
    const wakes = world.adapters.notifier
      .delivered()
      .filter((wake) => wake.reason === 'run_failed' || wake.reason === 'delegation_lapsed')
      .map((wake) => ({ reason: wake.reason, to: recipientIds(wake), link: wake.link }));
    assert.deepEqual(wakes, [
      { reason: 'run_failed', to: [owner], link: itemLink(scene.harnessId, scene.itemId) },
      { reason: 'delegation_lapsed', to: [owner], link: homeLink },
    ]);
    const decisions = world.adapters.notifier
      .decisions()
      .filter((decision) => decision.personId === owner)
      .map((decision) => decision.decision);
    assert.deepEqual(decisions, ['sent', 'sent']);
    return { state: { wakes, decisions } };
  },
});
