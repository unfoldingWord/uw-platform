import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { value } from '../runs.ts';
import { simParkedAtShip, standardChange } from '../ship-fixtures.ts';
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

function cardsOf(board: Awaited<ReturnType<World['kernel']['views']['board']>>, stageKey: string) {
  if (board.status !== 'accepted') throw new Error(`the board was refused: ${board.reason}`);
  return board.value.columns.find((column) => column.stage.key === stageKey)?.cards ?? [];
}

function holdersIn(
  board: Awaited<ReturnType<World['kernel']['views']['board']>>,
  stageKey: string,
) {
  return cardsOf(board, stageKey).map((card) => card.holder);
}

function holderOfItem(
  board: Awaited<ReturnType<World['kernel']['views']['board']>>,
  stageKey: string,
  itemId: string,
) {
  return cardsOf(board, stageKey).find((entry) => entry.item.itemId === itemId)?.holder;
}

async function claimantHolds(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  const caller = simCaller(world, admin);
  const { itemId } = value(
    await world.kernel.items.enqueue(caller, {
      harnessId: harness.id,
      title: 'Hold the package',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  const claimedAt = world.adapters.clock.now();
  value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
  world.adapters.clock.advance(25 * hour);
  const board = await world.kernel.views.board(caller, {
    harnessId: harness.id,
    stageKey: null,
    after: null,
  });
  const holder = {
    role: 'claimant',
    kind: 'person',
    identity: admin.identity,
    since: claimedAt,
  };
  expect(holdersIn(board, 'package')).toEqual([holder]);
  const play = value(await world.kernel.views.playByPlay(caller, { itemId, after: 0 }));
  expect(play.holder).toEqual(holder);
}

async function reviewerHolds(world: World): Promise<void> {
  const scene = await reviewWorld(world);
  const caller = simCaller(world, scene.admin);
  const board = await world.kernel.views.board(caller, {
    harnessId: scene.harnessId,
    stageKey: null,
    after: null,
  });
  expect(holderOfItem(board, 'check', scene.itemId)).toMatchObject({
    role: 'reviewer',
    kind: 'agent',
    identity: 'agent:reviewer',
  });
}

async function deciderHolds(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  const parked = await simParkedAtShip(world, {
    harnessId: harness.id,
    editor: admin,
    title: 'Merge the board change',
    change: standardChange,
  });
  const parkedAt = world.adapters.clock.now();
  world.adapters.clock.advance(hour);
  const caller = simCaller(world, admin);
  const play = value(
    await world.kernel.views.playByPlay(caller, { itemId: parked.itemId, after: 0 }),
  );
  expect(play.holder).toEqual({
    role: 'decider',
    kind: 'person',
    identity: null,
    since: parkedAt,
  });
}

describe('OB-2 the Board and the item show who holds the ball and since when', () => {
  it('OB-2 a person who claims an item holds it from the claim', () => inWorld(claimantHolds));
  it('OB-2 the Reviewer holds the item it claimed under a review delegation', () =>
    inWorld(reviewerHolds));
  it('OB-2 an item parked at Ship waits on a person to decide from when it parked', () =>
    inWorld(deciderHolds));
});
