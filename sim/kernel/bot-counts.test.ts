import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { reviewWorld } from '../review-runs.ts';
import { simParkedAtShip, shipPullRequest, standardChange } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function boardLeavesBotOut(world: World): Promise<void> {
  const scene = await reviewWorld(world);
  world.adapters.githubFacts.givenAuthor(shipPullRequest, 'dependabot[bot]');
  const caller = simCaller(world, scene.admin);
  const board = await world.kernel.views.board(caller, {
    harnessId: scene.harnessId,
    stageKey: null,
    after: null,
  });
  if (board.status !== 'accepted') throw new Error(board.reason);
  const check = board.value.columns.find((column) => column.stage.key === 'check');
  expect(check?.cards.map((card) => card.item.itemId)).toContain(scene.itemId);
  expect(check?.uncounted).toBe(1);
}

async function boardCountsPerson(world: World): Promise<void> {
  const scene = await reviewWorld(world);
  world.adapters.githubFacts.givenAuthor(shipPullRequest, 'outside-reviewer');
  const caller = simCaller(world, scene.admin);
  const board = await world.kernel.views.board(caller, {
    harnessId: scene.harnessId,
    stageKey: null,
    after: null,
  });
  if (board.status !== 'accepted') throw new Error(board.reason);
  expect(board.value.columns.every((column) => column.uncounted === 0)).toBe(true);
}

async function homeLeavesBotOut(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  await simParkedAtShip(world, {
    harnessId: harness.id,
    editor: admin,
    title: 'Bump the lockfile',
    change: standardChange,
  });
  world.adapters.githubFacts.givenAuthor(shipPullRequest, 'Dependabot[bot]');
  const waiting = await world.kernel.views.waitingOn(simCaller(world, admin));
  expect(waiting.rows.filter((row) => row.kind === 'gate')).toHaveLength(1);
  expect(waiting.uncounted).toBe(1);
}

async function noBotsCountsAll(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software, { botAuthors: [] });
  await simParkedAtShip(world, {
    harnessId: harness.id,
    editor: admin,
    title: 'Bump the lockfile',
    change: standardChange,
  });
  world.adapters.githubFacts.givenAuthor(shipPullRequest, 'dependabot[bot]');
  expect(harness.botAuthors).toEqual([]);
  expect((await world.kernel.views.waitingOn(simCaller(world, admin))).uncounted).toBe(0);
}

describe('OB-4 counts leave out pull requests a listed bot opened', () => {
  it('OB-4 the Board leaves the bot item out of the Check count and keeps its card', () =>
    inWorld(boardLeavesBotOut));
  it('OB-4 the Board counts a pull request whose author is not listed', () =>
    inWorld(boardCountsPerson));
  it('OB-4 Home lists a gate on a bot pull request and does not count it', () =>
    inWorld(homeLeavesBotOut));
  it('OB-4 a harness activated with no bot authors counts every item', () =>
    inWorld(noBotsCountsAll));
});
