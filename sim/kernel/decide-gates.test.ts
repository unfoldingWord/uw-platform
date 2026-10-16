import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type BatchEntry } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { detailOf, reasonOf, value } from '../runs.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  type ItemLog,
  secondChange,
  simParkedAtShip,
  standardChange,
  type ShipChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly admin: Principal;
  readonly harnessId: string;
  readonly first: ItemState;
  readonly second: ItemState;
};

function factsFor(world: World, item: ItemState, change: ShipChange, approved: boolean) {
  const reviews = approved
    ? [
        approvedBy(
          'uw-reviewer[bot]',
          'deepinfra',
          change.head,
          change === standardChange ? 9300000001 : 9300000002,
        ),
      ]
    : [];
  return greenFacts(world, {
    itemId: item.itemId,
    head: change.head,
    ref: change.pullRequest,
    reviews,
  });
}

async function inScene(
  secondApproved: boolean,
  work: (scene: Scene) => Promise<void>,
): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = (title: string, change: ShipChange) =>
      simParkedAtShip(world, { harnessId: harness.id, editor: admin, title, change });
    const first = await parked('Show the board', standardChange);
    const second = await parked('Show the flow', secondChange);
    world.adapters.githubFacts.given(factsFor(world, first, standardChange, true));
    world.adapters.githubFacts.given(factsFor(world, second, secondChange, secondApproved));
    await work({ world, admin, harnessId: harness.id, first, second });
  } finally {
    await world.close();
  }
}

function entry(item: ItemState, decision: BatchEntry['decision'] = 'approve'): BatchEntry {
  return { itemId: item.itemId, head: item.expectedHead ?? '', decision };
}

function batch(scene: Scene, entries: readonly BatchEntry[], actor: Principal = scene.admin) {
  return scene.world.kernel.gates.decideGates(simCaller(scene.world, actor), {
    harnessId: scene.harnessId,
    entries,
  });
}

async function logs(scene: Scene) {
  return Promise.all(
    [scene.first, scene.second].map((item) => itemLog(scene.world, scene.harnessId, item.itemId)),
  );
}

function calledHeads(scene: Scene): readonly (string | null)[] {
  return scene.world.adapters.connectors.calls().map((call) => call.expectedHead);
}

function decisionsOf(logged: readonly ItemLog[]): readonly (readonly string[])[] {
  return logged.map((log) => log.decisions);
}

function lengthsOf(logged: readonly ItemLog[]): readonly number[] {
  return logged.map((log) => log.events.length);
}

async function bothMerge(scene: Scene): Promise<void> {
  const decided = value(await batch(scene, [entry(scene.first), entry(scene.second)]));
  expect(decided.decided.map((one) => one.advanced)).toEqual([true, true]);
  expect(decisionsOf(await logs(scene))).toEqual([['approve'], ['approve']]);
  expect([...calledHeads(scene)].sort()).toEqual([standardChange.head, secondChange.head].sort());
}

async function refusedWhole(scene: Scene): Promise<void> {
  const before = await logs(scene);
  const refused = await batch(scene, [entry(scene.first), entry(scene.second)]);
  expect(reasonOf(refused)).toBe('no_reviewer_approval');
  expect(detailOf(refused)).toMatchObject({ itemId: scene.second.itemId });
  const after = await logs(scene);
  expect(decisionsOf(after)).toEqual([[], []]);
  expect(lengthsOf(after)).toEqual(lengthsOf(before));
  expect(scene.world.adapters.connectors.calls()).toEqual([]);
}

async function staleHead(scene: Scene): Promise<void> {
  const stale = { ...entry(scene.second, 'reject'), head: 'f'.repeat(40) };
  const refused = await batch(scene, [entry(scene.first), stale]);
  expect(reasonOf(refused)).toBe('head_mismatch');
  expect(detailOf(refused)).toMatchObject({ itemId: scene.second.itemId });
}

async function shapesRefused(scene: Scene): Promise<void> {
  expect(value(await batch(scene, [entry(scene.second, 'reject')])).decided).toHaveLength(1);
  const repeated = await batch(scene, [entry(scene.first), entry(scene.first)]);
  expect(reasonOf(repeated)).toBe('malformed_command');
  expect(reasonOf(await batch(scene, []))).toBe('malformed_command');
  const elsewhere = await scene.world.kernel.gates.decideGates(
    simCaller(scene.world, scene.admin),
    {
      harnessId: scene.world.adapters.ids.next(),
      entries: [entry(scene.first)],
    },
  );
  expect(reasonOf(elsewhere)).toBe('item_not_found');
  const agent = { ...scene.admin, identity: 'agent:builder', kind: 'agent' as const };
  expect(reasonOf(await batch(scene, [entry(scene.first)], agent))).toBe('not_permitted');
}

describe('GD-1 decide_gates', () => {
  it('GD-1 writes one gate decision per item in one call, each pinned to its own head, and merges each', () =>
    inScene(true, bothMerge));

  it('GD-1 fails the whole batch on one refusal, names the refusing item, and records nothing', () =>
    inScene(false, refusedWhole));

  it('GD-1 refuses an entry whose head is not the head the item expects, for a reject too', () =>
    inScene(true, staleHead));

  it('GD-1 rejects with a pinned head, and refuses a repeated item, an empty batch, an item elsewhere and an agent', () =>
    inScene(true, shapesRefused));
});
