import type { Harness, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simParkedAtCheck, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly harness: Harness; readonly admin: Principal };

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    await work({ world, harness, admin });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function remove(scene: Scene, who: Principal, stageKey: string) {
  return scene.world.kernel.stages.removeStage(simCaller(scene.world, who), {
    harnessId: scene.harness.id,
    stageKey,
  });
}

function refusal(outcome: KernelOutcome<unknown>) {
  return outcome.status === 'accepted' ? 'accepted' : [outcome.reason, outcome.detail];
}

function written(scene: Scene) {
  return scene.world.adapters.store.transaction(async (tx) => ({
    stages: (await tx.harnessStages.read.forHarness(scene.harness.id)).map((stage) => stage.key),
    events: (await readAllEvents(tx, scene.harness.id, null)).map((event) => event.name),
  }));
}

async function nonAdminsRefused(scene: Scene): Promise<void> {
  const editor = await simPerson(scene.world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const agent = simAgent(scene.admin, 'builder', { interactive: true });
  const before = await written(scene);
  const outcomes = [await remove(scene, editor, 'plan'), await remove(scene, agent, 'plan')];
  expect(outcomes.map((outcome) => outcome.status === 'error' && outcome.reason)).toEqual([
    'not_permitted',
    'not_permitted',
  ]);
  expect(await written(scene)).toEqual(before);
}

async function approvedPastCheck(scene: Scene): Promise<void> {
  const { world, harness, admin } = scene;
  const parked = await simParkedAtCheck(world, {
    harnessId: harness.id,
    admin,
    title: 'Check the board',
  });
  const approved = await world.kernel.gates.decide(simCaller(world, admin), {
    itemId: parked.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
  expect(approved.status === 'accepted' && approved.value.item.stageKey).toBe('ship');
}

describe('KN-18 stage removal', () => {
  sceneIt('KN-18 removal of an unknown stage is stage_not_found', async (scene) => {
    const before = await written(scene);
    expect(refusal(await remove(scene, scene.admin, 'nowhere'))).toEqual([
      'stage_not_found',
      { stage: 'nowhere' },
    ]);
    expect(await written(scene)).toEqual(before);
  });

  sceneIt('KN-18 a non-admin cannot remove a stage', nonAdminsRefused);

  sceneIt(
    'KN-18 a stage with gate decision history cannot be removed even when it holds no item',
    async (scene) => {
      await approvedPastCheck(scene);
      const before = await written(scene);
      expect(refusal(await remove(scene, scene.admin, 'check'))).toEqual([
        'stage_not_empty',
        { stage: 'check', why: 'stage_has_history' },
      ]);
      expect(await written(scene)).toEqual(before);
    },
  );

  sceneIt(
    'KN-18 removing a stage another stage feeds is unknown_feed_target and records stage_edit_refused',
    async (scene) => {
      const before = await written(scene);
      expect(refusal(await remove(scene, scene.admin, 'package'))).toEqual([
        'unknown_feed_target',
        { stage: 'validate', target: 'package' },
      ]);
      expect(await written(scene)).toEqual({
        stages: before.stages,
        events: [...before.events, 'stage_edit_refused'],
      });
    },
  );
});
