import type { ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import {
  approvedBy,
  greenFacts,
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

function approvedFacts(world: World, item: ItemState, change: ShipChange, reviewId: number) {
  const reviews = [approvedBy('uw-reviewer[bot]', 'deepinfra', change.head, reviewId)];
  return greenFacts(world, {
    itemId: item.itemId,
    head: change.head,
    ref: change.pullRequest,
    reviews,
  });
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = (title: string, change: ShipChange) =>
      simParkedAtShip(world, { harnessId: harness.id, editor: admin, title, change });
    const first = await parked('Show the board', standardChange);
    const second = await parked('Show the flow', secondChange);
    world.adapters.githubFacts.given(approvedFacts(world, first, standardChange, 9300000001));
    world.adapters.githubFacts.given(approvedFacts(world, second, secondChange, 9300000002));
    await work({ world, admin, harnessId: harness.id, first, second });
  } finally {
    await world.close();
  }
}

function approve(scene: Scene, item: ItemState) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: item.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: item.expectedHead,
  });
}

function freeze(scene: Scene, actor: Principal, frozen: boolean, allow: readonly string[]) {
  const caller = simCaller(scene.world, actor);
  return scene.world.kernel.stages.setFreeze(caller, { harnessId: scene.harnessId, frozen, allow });
}

async function freezeChanges(scene: Scene): Promise<number> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events.filter((event) => event.name === 'freeze_changed').length;
}

describe('GD-2 freeze', () => {
  it('GD-2 refuses Ship harness_frozen for an item not on the list and advances the named one', () =>
    inScene(async (scene) => {
      const frozen = value(await freeze(scene, scene.admin, true, [scene.second.itemId]));
      expect(frozen.harness).toMatchObject({ frozen: true, freezeAllow: [scene.second.itemId] });
      expect(reasonOf(await approve(scene, scene.first))).toBe('harness_frozen');
      expect(value(await approve(scene, scene.second)).advanced).toBe(true);
    }));

  it('GD-2 lifting the freeze lets the other item ship, and each change is one freeze_changed', () =>
    inScene(async (scene) => {
      value(await freeze(scene, scene.admin, true, []));
      value(await freeze(scene, scene.admin, true, []));
      value(await freeze(scene, scene.admin, false, []));
      expect(value(await approve(scene, scene.first)).advanced).toBe(true);
      expect(await freezeChanges(scene)).toBe(2);
    }));

  it('GD-2 refuses a lift that names items, an item of another harness, a non-admin and an agent', () =>
    inScene(async (scene) => {
      expect(reasonOf(await freeze(scene, scene.admin, false, [scene.first.itemId]))).toBe(
        'malformed_command',
      );
      expect(
        reasonOf(await freeze(scene, scene.admin, true, [scene.world.adapters.ids.next()])),
      ).toBe('item_not_found');
      const editor = await simPerson(scene.world, 7, [
        { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
      ]);
      expect(reasonOf(await freeze(scene, editor, true, []))).toBe('not_permitted');
      const agent = simAgent(scene.admin, 'builder', { interactive: true });
      expect(reasonOf(await freeze(scene, agent, true, []))).toBe('not_permitted');
    }));
});
