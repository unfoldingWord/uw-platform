import type { ItemState, Principal, Stage } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { exitThroughConnector } from '@uw/harness/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simPerson } from '../fixtures.ts';
import { simParkedAtShip, standardChange } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly ian: Principal;
  readonly item: ItemState;
  readonly stages: readonly Stage[];
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin, stages } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const item = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: max,
      title: 'Show the board',
      change: standardChange,
    });
    await work({ world, ian: admin, item, stages });
  } finally {
    await world.close();
  }
}

function stageOf(scene: Scene, key: string): Stage {
  const stage = scene.stages.find((entry) => entry.key === key);
  if (stage === undefined) throw new Error(`no stage ${key}`);
  return stage;
}

type Crafted = { readonly item?: ItemState; readonly stage?: Stage; readonly decisionId?: string };

function exitWith(scene: Scene, crafted: Crafted): Promise<boolean> {
  const { world } = scene;
  return exitThroughConnector(
    world.adapters,
    {
      actor: scene.ian.identity,
      at: world.adapters.clock.now(),
      traceId: world.adapters.ids.next(),
      requestId: null,
      ids: world.adapters.ids,
    },
    {
      item: crafted.item ?? scene.item,
      stage: crafted.stage ?? stageOf(scene, 'ship'),
      connector: 'merge',
      next: stageOf(scene, 'validate'),
      decisionId: crafted.decisionId ?? world.adapters.ids.next(),
      overrideReason: null,
      repository: 'unfoldingWord/uw-platform',
      expectedBase: null,
    },
  );
}

async function lastNames(scene: Scene): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.item.harnessId, scene.item.itemId),
  );
  return events.slice(-1).map((event) => event.name);
}

async function stageKeyOf(scene: Scene): Promise<string | undefined> {
  const item = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.byId(scene.item.itemId),
  );
  return item?.stageKey;
}

async function recordsOnlyTheConnector(scene: Scene, crafted: Crafted): Promise<void> {
  expect(await exitWith(scene, crafted)).toBe(false);
  expect(await lastNames(scene)).toEqual(['connector_succeeded']);
  expect(await stageKeyOf(scene)).toBe('ship');
}

function takeOver(scene: Scene): Promise<KernelOutcome<unknown>> {
  return scene.world.kernel.gates.decide(
    { actor: scene.ian, traceId: scene.world.adapters.ids.next() },
    { itemId: scene.item.itemId, decision: 'take_over', reason: null, findings: [] },
  );
}

describe('KN-13 the stage exit after a connector advances only the parking that was approved', () => {
  it('does not advance an item that is no longer at the approved stage', () =>
    inScene((scene) => recordsOnlyTheConnector(scene, { stage: stageOf(scene, 'check') })));

  it('does not advance an item that is no longer parked', () =>
    inScene(async (scene) => {
      expect((await takeOver(scene)).status).toBe('accepted');
      expect(await exitWith(scene, {})).toBe(false);
      expect(await lastNames(scene)).toEqual(['connector_succeeded']);
    }));

  it('does not advance an item whose head changed since the approval', () =>
    inScene((scene) =>
      recordsOnlyTheConnector(scene, { item: { ...scene.item, expectedHead: 'fff999' } }),
    ));

  it('does not advance when the approval is not in the log', () =>
    inScene((scene) => recordsOnlyTheConnector(scene, {})));
});
