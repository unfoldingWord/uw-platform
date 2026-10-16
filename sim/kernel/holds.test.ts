import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { shipPullRequest } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const hour = 3_600_000;

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function reviewerHeldTooLong(world: World): Promise<void> {
  const scene = await reviewWorld(world);
  world.adapters.clock.advance(2 * hour + 1);
  const holds = await world.kernel.views.holds();
  expect(holds.agent.map((row) => [row.item.itemId, row.holder.role])).toEqual([
    [scene.itemId, 'reviewer'],
  ]);
  expect(holds.person).toEqual([]);
  const rows = await world.kernel.views.planeList(simCaller(world, scene.admin), 'held_by_agent');
  expect(rows.map((row) => row.cells['role'])).toEqual(['reviewer']);
}

async function botHoldLeftOut(world: World): Promise<void> {
  const scene = await reviewWorld(world);
  world.adapters.githubFacts.givenAuthor(shipPullRequest, 'dependabot[bot]');
  world.adapters.clock.advance(2 * hour + 1);
  const holds = await world.kernel.views.holds();
  expect(holds.agent).toEqual([]);
  expect(holds.uncounted).toEqual({ person: 0, agent: 1 });
  const caller = simCaller(world, scene.admin);
  expect(await world.kernel.views.planeList(caller, 'held_by_agent')).toEqual([]);
}

async function claimedNotWaiting(world: World): Promise<void> {
  const scene = await reviewWorld(world);
  const rows = await world.kernel.views.planeList(simCaller(world, scene.admin), 'silence_alarm');
  expect(rows.map((row) => row.cells['harness'])).toEqual([]);
}

describe('OB-2 /health counts who has held the ball too long', () => {
  it('OB-2 the Reviewer holding an item over 2 hours is counted with an agent and listed in the drill-through', () =>
    inWorld(reviewerHeldTooLong));

  it('OB-4 the same hold on a listed bot pull request is left out of the count and the rows', () =>
    inWorld(botHoldLeftOut));

  it('OB-1 the silence drill-through does not list an item the Reviewer has claimed', () =>
    inWorld(claimedNotWaiting));
});
