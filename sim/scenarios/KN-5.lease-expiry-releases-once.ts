import assert from 'node:assert/strict';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import type { World } from '../world.ts';
import { createSimHarness, simAgent, simCaller, simIan, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

const minute = 60_000;

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function namesOf(world: World, harnessId: string, itemId: string): Promise<string[]> {
  const events = await world.adapters.store.transaction((tx) =>
    readAllEvents(tx, harnessId, itemId),
  );
  return events.map((event) => event.name);
}

type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Caller;
  readonly editor: Caller;
  readonly builder: Caller;
  readonly reviewer: Caller;
};

async function cast(world: World): Promise<Cast> {
  const { harness } = await createSimHarness(world, software);
  const admin = simCaller(world, await simIan(world));
  await world.kernel.stages.updateStage(admin, {
    harnessId: harness.id,
    stageKey: 'package',
    change: { agentPickup: 'allowed' },
  });
  const owner = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const device = (name: string) =>
    simCaller(world, simAgent(owner, `${owner.personId}/${name}`, { interactive: true }));
  return {
    world,
    harnessId: harness.id,
    admin,
    editor: simCaller(world, owner),
    builder: device('builder'),
    reviewer: device('reviewer'),
  };
}

async function enqueue(scene: Cast, title: string): Promise<string> {
  const outcome = await scene.world.kernel.items.enqueue(scene.editor, {
    harnessId: scene.harnessId,
    title,
    pageId: null,
    priority: 1,
    due: null,
  });
  return valueOf(outcome).itemId;
}

async function claim(scene: Cast, caller: Caller, itemId: string): Promise<void> {
  valueOf(await scene.world.kernel.items.claim(caller, { itemId, delegationId: null }));
}

async function sweep(scene: Cast): Promise<readonly string[]> {
  const swept = await scene.world.kernel.items.expireLeases(scene.admin, { limit: 10 });
  return valueOf(swept).expired;
}

const logOf = ['item_created', 'item_claimed', 'lease_expired', 'item_claimed'];

export const scenario = defineScenario({
  id: 'KN-5',
  title:
    'a lapsed lease is released and lease_expired written once, whether the sweep or the next claim sees it first',
  run: async (world) => {
    const scene = await cast(world);
    const sweepFirst = await enqueue(scene, 'Swept first');
    const claimFirst = await enqueue(scene, 'Claimed first');
    await claim(scene, scene.builder, sweepFirst);
    await claim(scene, scene.builder, claimFirst);
    world.adapters.clock.advance(16 * minute);
    assert.deepEqual([...(await sweep(scene))].sort(), [sweepFirst, claimFirst].sort());
    assert.deepEqual(await sweep(scene), []);
    await claim(scene, scene.reviewer, sweepFirst);
    const names = await namesOf(world, scene.harnessId, sweepFirst);
    assert.deepEqual(names, logOf);
    const release = { itemId: sweepFirst, delegationId: null };
    valueOf(await world.kernel.items.release(scene.reviewer, release));
    const lazy = await enqueue(scene, 'Claimed lazily');
    await claim(scene, scene.builder, lazy);
    world.adapters.clock.advance(16 * minute);
    await claim(scene, scene.reviewer, lazy);
    assert.deepEqual(await sweep(scene), []);
    const lazyNames = await namesOf(world, scene.harnessId, lazy);
    assert.deepEqual(lazyNames, logOf);
    return { state: { sweepFirst: names, claimFirst: lazyNames } };
  },
});
