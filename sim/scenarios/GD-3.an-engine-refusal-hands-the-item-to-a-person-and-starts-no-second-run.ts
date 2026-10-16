import assert from 'node:assert/strict';
import { readSpend } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { itemEvents, itemOf, systemCaller, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const DAY_MS = 24 * 3_600_000;

export const scenario = defineScenario({
  id: 'GD-3',
  title:
    'an engine refusal fails the run engine_refused, hands the item to the delegation grantor, and the beat starts no second run after the backoff',
  run: async (world) => {
    const scene = await reviewWorld(world);
    const why = { step: 'work' as const, why: 'engine_refused' as const, detail: null };
    value(await world.kernel.runs.fail(scene.host, scene.runId, why));
    const handed = (await itemEvents(scene, scene.itemId)).at(-1);
    world.adapters.clock.advance(2 * DAY_MS);
    await readSpend(world);
    const beaten = value(await world.kernel.runs.beat(systemCaller(scene), { limit: 10 }));
    const item = await itemOf(world, scene.itemId);
    assert.equal(handed?.name, 'handed_to_person');
    assert.deepEqual(handed.evidence, {
      personId: scene.owner.personId,
      why: 'engine_refused',
      rounds: null,
    });
    assert.equal(item?.holder, `human:${scene.owner.personId ?? ''}`);
    assert.equal(beaten.started.length, 0);
    return { state: { handed: handed.evidence, started: beaten.started.length } };
  },
});
