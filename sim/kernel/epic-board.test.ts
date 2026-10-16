import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { Principal } from '@uw/contracts';
import { software, type BoardView } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEpicAs, epicFact, epicOf, epicOfFour } from '../epics.ts';
import { createSimHarness, simCaller, simIngest } from '../fixtures.ts';
import { value } from '../runs.ts';
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

async function boardOf(
  world: World,
  admin: Principal,
  harnessId: string,
  stageKey: string | null = null,
): Promise<BoardView> {
  return value(
    await world.kernel.views.board(simCaller(world, admin), { harnessId, stageKey, after: null }),
  );
}

function placesOf(board: BoardView) {
  return board.epics[0]?.nodes.map((node) => [node.issue?.number, node.waiting]);
}

function refusedOf(board: BoardView) {
  return board.notReady.map((entry) => [entry.via, entry.issue?.number]);
}

async function groupsOneEpic(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  world.adapters.githubFacts.givenEpic(epicOfFour);
  const { items } = value(await enqueueEpicAs(world, admin, harness.id));
  const board = await boardOf(world, admin, harness.id);
  expect(board.epics).toHaveLength(1);
  expect(board.epics[0]?.title).toBe('Epic intake');
  expect(placesOf(board)).toEqual([
    [41, false],
    [42, false],
    [43, false],
    [44, true],
  ]);
  expect(board.epics[0]?.nodes[3]?.blockedBy).toEqual([items[2]?.itemId]);
  expect((await boardOf(world, admin, harness.id, 'package')).epics).toEqual([]);
}

async function listsNotReady(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  const issue = { repo: 'unfoldingWord/uw-platform', number: 12, githubId: 9100000012 };
  const ingest = simCaller(world, simIngest());
  const input = { harnessId: harness.id, issue, title: 'Wire the board', pageId: null };
  await world.kernel.items.importIssue(ingest, { ...input, doneWhen: [] });
  world.adapters.githubFacts.givenEpic(
    epicOf([epicFact(41, 'Ready'), epicFact(42, 'Not ready', { doneWhen: [] })]),
  );
  await enqueueEpicAs(world, admin, harness.id);
  expect(refusedOf(await boardOf(world, admin, harness.id))).toEqual([
    ['enqueue_epic', 42],
    ['import', 12],
  ]);
  const ready = { ...input, doneWhen: ['The board lists every stage.'] };
  value(await world.kernel.items.importIssue(ingest, ready));
  expect(refusedOf(await boardOf(world, admin, harness.id))).toEqual([['enqueue_epic', 42]]);
}

describe('EI-5 the Board groups an epic’s items with their blocker edges', () => {
  it('shows one group under the epic’s title, in sub-issue order, with the blocked item waiting', () =>
    inWorld(groupsOneEpic));
});

describe('EI-2 the Board lists what intake refused as not ready', () => {
  it('lists an issue refused for a missing done-when until it becomes an item', () =>
    inWorld(listsNotReady));
});
