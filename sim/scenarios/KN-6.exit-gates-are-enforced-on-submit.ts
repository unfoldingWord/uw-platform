import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAdvance, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly owner: Principal;
  readonly editor: Caller;
  readonly builder: Caller;
};

const input = (itemId: string) => ({ itemId, to: null, evidence: {}, change: null });

async function cast(world: World): Promise<Cast> {
  const { harness } = await createSimHarness(world, software);
  const owner = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const editor = simCaller(world, owner);
  const builder = simCaller(
    world,
    simAgent(owner, `${owner.personId}/builder`, { interactive: true }),
  );
  const { itemId } = valueOf(
    await world.kernel.items.enqueue(editor, {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    }),
  );
  return { world, harnessId: harness.id, itemId, owner, editor, builder };
}

async function passGates(scene: Cast): Promise<void> {
  const { world, itemId, editor, builder } = scene;
  valueOf(await world.kernel.items.claim(editor, { itemId, delegationId: null }));
  const packaged = valueOf(await world.kernel.items.submit(editor, input(itemId)));
  assert.equal(packaged.result, 'advanced');
  assert.equal(packaged.item.stageKey, 'scope');
  assert.equal(packaged.item.holder, null);
  valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  const scoped = valueOf(await world.kernel.items.submit(builder, input(itemId)));
  assert.equal(scoped.result, 'advanced');
  assert.equal(scoped.item.stageKey, 'plan');
  const events = await world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, itemId),
  );
  assert.ok(events.some((event) => event.name === 'checks_passed'));
}

async function parkAtShip(scene: Cast): Promise<string | undefined> {
  const { world, itemId, editor } = scene;
  const atShip = await simAdvance(world, {
    harnessId: scene.harnessId,
    itemId,
    worker: simAgent(scene.owner, `${scene.owner.personId}/builder`, { interactive: true }),
    through: ['plan', 'build', 'check'],
  });
  assert.equal(atShip.stageKey, 'ship');
  valueOf(await world.kernel.items.claim(editor, { itemId, delegationId: null }));
  const parked = valueOf(await world.kernel.items.submit(editor, input(itemId)));
  assert.equal(parked.result, 'parked');
  assert.equal(parked.item.stageKey, 'ship');
  assert.equal(parked.item.gateStatus, 'parked');
  assert.equal(parked.item.holder, null);
  const again = await world.kernel.items.submit(editor, input(itemId));
  assert.equal(again.status === 'error' && again.reason, 'not_holder');
  const still = await world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
  return still?.stageKey;
}

export const scenario = defineScenario({
  id: 'KN-6',
  title:
    'a none gate advances, a checks gate advances on passing validators, and a human approval gate parks the item',
  run: async (world) => {
    const scene = await cast(world);
    await passGates(scene);
    const stage = await parkAtShip(scene);
    assert.equal(stage, 'ship');
    return { state: { stage, gateStatus: 'parked' } };
  },
});
