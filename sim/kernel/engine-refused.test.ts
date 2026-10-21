import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { readSpend, simCaller } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, itemOf, systemCaller, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const DAY_MS = 24 * 3_600_000;

async function inWorld(work: (scene: ReviewWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await reviewWorld(world));
  } finally {
    await world.close();
  }
}

function beat(scene: ReviewWorld) {
  return scene.world.kernel.runs.beat(systemCaller(scene), { limit: 10 });
}

const refusal = { step: 'work' as const, why: 'engine_refused' as const, detail: null };

async function handedAndHeld(scene: ReviewWorld): Promise<void> {
  value(await scene.world.kernel.runs.fail(scene.host, scene.runId, refusal));
  const tail = (await itemEvents(scene, scene.itemId)).slice(-3);
  expect(tail.map((event) => event.name)).toEqual([
    'run_failed',
    'item_released',
    'handed_to_person',
  ]);
  expect(tail[2]?.evidence).toEqual({
    personId: scene.owner.personId,
    why: 'engine_refused',
    rounds: null,
  });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    holder: `human:${scene.owner.personId ?? ''}`,
  });
  scene.world.adapters.clock.advance(2 * DAY_MS);
  await readSpend(scene.world);
  expect(value(await beat(scene))).toEqual({ started: [], skipped: [] });
}

async function releasedAndDispatched(scene: ReviewWorld): Promise<void> {
  value(await scene.world.kernel.runs.fail(scene.host, scene.runId, refusal));
  const person = simCaller(scene.world, scene.owner);
  value(
    await scene.world.kernel.items.release(person, { itemId: scene.itemId, delegationId: null }),
  );
  scene.world.adapters.clock.advance(2 * DAY_MS);
  await readSpend(scene.world);
  expect(value(await beat(scene)).started).toHaveLength(1);
}

describe('GD-3 refusals are never routed around', () => {
  it('GD-3 hands the item to the grantor and starts no second run, on any engine, even after the backoff', () =>
    inWorld(handedAndHeld));

  it('GD-3 dispatches again once the person releases the item', () =>
    inWorld(releasedAndDispatched));
});
