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
  readonly builder: Caller;
};

const exitTo = (itemId: string, to: string) => ({ itemId, to, evidence: {}, change: null });

async function cast(world: World): Promise<Cast> {
  const { harness, admin } = await createSimHarness(world, software);
  const owner = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const builder = simCaller(
    world,
    simAgent(owner, `${owner.personId}/builder`, { interactive: true }),
  );
  const editor = simCaller(world, owner);
  const owned = simCaller(world, admin);
  const { itemId } = valueOf(
    await world.kernel.items.enqueue(editor, {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    }),
  );
  valueOf(
    await world.kernel.stages.updateStage(owned, {
      harnessId: harness.id,
      stageKey: 'plan',
      change: { feeds: ['scope'] },
    }),
  );
  valueOf(
    await world.kernel.stages.updateStage(owned, {
      harnessId: harness.id,
      stageKey: 'scope',
      change: { feeds: ['package'] },
    }),
  );
  const atPlan = await simAdvance(world, {
    harnessId: harness.id,
    itemId,
    worker: owner,
    through: ['package', 'scope'],
  });
  assert.equal(atPlan.stageKey, 'plan');
  return { world, harnessId: harness.id, itemId, owner, builder };
}

async function loopBack(scene: Cast): Promise<void> {
  const { world, itemId, builder } = scene;
  valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  const looped = valueOf(await world.kernel.items.submit(builder, exitTo(itemId, 'scope')));
  assert.equal(looped.result, 'advanced');
  assert.equal(looped.item.itemId, itemId);
  assert.equal(looped.item.stageKey, 'scope');
  assert.equal(looped.item.holder, null);
  assert.equal(looped.item.gateStatus, 'working');
  const events = await world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, itemId),
  );
  const taken = events.filter((event) => event.name === 'loop_edge_taken');
  assert.equal(taken.length, 1);
  assert.deepEqual(taken[0]?.evidence, { from: 'plan', to: 'scope' });
}

async function refuseAndTweak(scene: Cast) {
  const { world, itemId, builder } = scene;
  valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  const refused = await world.kernel.items.submit(builder, exitTo(itemId, 'close'));
  assert.equal(refused.status === 'error' && refused.reason, 'transition_not_allowed');
  const tweak = valueOf(await world.kernel.items.submit(builder, exitTo(itemId, 'package')));
  assert.equal(tweak.result, 'parked');
  assert.equal(tweak.item.gateTarget, 'package');
  assert.equal(tweak.item.stageKey, 'scope');
  return tweak.item;
}

export const scenario = defineScenario({
  id: 'KN-8',
  title:
    'a feeds edge re-enters the same item at an earlier stage, a stage that is neither next nor fed is refused, and the tweak to Package parks for a person',
  run: async (world) => {
    const scene = await cast(world);
    await loopBack(scene);
    const parked = await refuseAndTweak(scene);
    return { state: { parked } };
  },
});
