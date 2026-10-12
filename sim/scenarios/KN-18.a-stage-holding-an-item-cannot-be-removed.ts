import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAdvance, simCaller } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

type Scene = { readonly world: World; readonly harnessId: string; readonly admin: Principal };

const spare = {
  key: 'spare',
  title: 'Spare',
  position: 25,
  bracket: 'build_package' as const,
  agentPickup: 'allowed' as const,
  exitGate: 'checks' as const,
  connector: 'none' as const,
  wipLimit: 3,
  instructionsPageId: null,
  validators: [],
  feeds: [],
};

function remove(scene: Scene, stageKey: string) {
  return scene.world.kernel.stages.removeStage(simCaller(scene.world, scene.admin), {
    harnessId: scene.harnessId,
    stageKey,
  });
}

function refusal(outcome: KernelOutcome<unknown>) {
  return outcome.status === 'accepted' ? 'accepted' : [outcome.reason, outcome.detail];
}

async function stageKeys(scene: Scene): Promise<readonly string[]> {
  const stages = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(scene.harnessId),
  );
  return stages.map((stage) => stage.key);
}

async function itemAtPlan(scene: Scene): Promise<string> {
  const enqueued = await scene.world.kernel.items.enqueue(simCaller(scene.world, scene.admin), {
    harnessId: scene.harnessId,
    title: 'Plan the board',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  assert.equal(enqueued.status, 'accepted');
  if (enqueued.status !== 'accepted') throw new Error('unreachable');
  const { itemId, harnessId } = enqueued.value;
  const item = await simAdvance(scene.world, {
    harnessId,
    itemId,
    worker: scene.admin,
    through: ['package', 'scope'],
  });
  assert.equal(item.stageKey, 'plan');
  return itemId;
}

async function removeSpare(scene: Scene) {
  const created = await scene.world.kernel.stages.createStage(simCaller(scene.world, scene.admin), {
    harnessId: scene.harnessId,
    stage: spare,
  });
  assert.equal(created.status, 'accepted');
  const removed = await remove(scene, 'spare');
  assert.equal(removed.status, 'accepted');
  assert.deepEqual(
    removed.status === 'accepted' && removed.value.map((stage) => stage.key),
    software.stages.map((stage) => stage.key),
  );
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  const last = events.at(-1);
  assert.equal(last?.name, 'stage_removed');
  assert.equal(created.status === 'accepted' && last?.evidence['stageId'], created.value.id);
  assert.equal(last?.evidence['key'], 'spare');
  assert.deepEqual(last?.evidence['before'], { ...spare, paused: false });
  return last?.evidence ?? null;
}

export const scenario = defineScenario({
  id: 'KN-18',
  title:
    'a stage holding an item cannot be removed, an empty stage no other stage feeds is removed with a stage_removed event, and a stage with a connector is never removed',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const scene = { world, harnessId: harness.id, admin };
    await itemAtPlan(scene);
    assert.deepEqual(refusal(await remove(scene, 'plan')), ['stage_not_empty', { stage: 'plan' }]);
    const removed = await removeSpare(scene);
    assert.deepEqual(refusal(await remove(scene, 'ship')), [
      'not_permitted',
      { stage: 'ship', why: 'effect_stage' },
    ]);
    const keys = await stageKeys(scene);
    assert.ok(keys.includes('plan') && keys.includes('ship') && !keys.includes('spare'));
    const property = world.kernel.templateProperty(
      await world.adapters.store.transaction((tx) => tx.harnessStages.read.forHarness(harness.id)),
    );
    assert.deepEqual(property, []);
    return { state: { removed, keys } };
  },
});
