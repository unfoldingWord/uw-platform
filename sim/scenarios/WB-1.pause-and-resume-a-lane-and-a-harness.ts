import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

type Scene = { readonly world: World; readonly harnessId: string; readonly admin: Principal };

type Control = 'pause' | 'resume';

function control(scene: Scene, who: Principal, name: Control, stageKey: string | null) {
  const input = { harnessId: scene.harnessId, stageKey };
  const { stages } = scene.world.kernel;
  const caller = simCaller(scene.world, who);
  return name === 'pause' ? stages.pause(caller, input) : stages.resume(caller, input);
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'accepted' ? 'accepted' : outcome.reason;
}

async function controlLog(scene: Scene) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, null),
  );
  return events
    .filter((event) => event.name === 'harness_paused' || event.name === 'harness_resumed')
    .map((event) => [event.name, event.evidence['stage']]);
}

async function flags(scene: Scene) {
  return scene.world.adapters.store.transaction(async (tx) => {
    const harness = await tx.harnesses.read.byId(scene.harnessId);
    const stages = await tx.harnessStages.read.forHarness(scene.harnessId);
    return {
      harness: harness?.paused,
      lanes: stages.filter((stage) => stage.paused).map((stage) => stage.key),
    };
  });
}

async function lane(scene: Scene): Promise<void> {
  const paused = await control(scene, scene.admin, 'pause', 'build');
  assert.equal(paused.status, 'accepted');
  assert.equal(
    paused.status === 'accepted' &&
      paused.value.stages.find((stage) => stage.key === 'build')?.paused,
    true,
  );
  assert.deepEqual(await flags(scene), { harness: false, lanes: ['build'] });
  assert.equal(reasonOf(await control(scene, scene.admin, 'pause', 'build')), 'accepted');
  assert.deepEqual(await controlLog(scene), [['harness_paused', 'build']]);
  assert.equal(reasonOf(await control(scene, scene.admin, 'resume', 'build')), 'accepted');
  assert.deepEqual(await flags(scene), { harness: false, lanes: [] });
}

async function whole(scene: Scene): Promise<void> {
  const paused = await control(scene, scene.admin, 'pause', null);
  assert.equal(paused.status === 'accepted' && paused.value.harness.paused, true);
  assert.deepEqual(await flags(scene), { harness: true, lanes: [] });
  assert.equal(reasonOf(await control(scene, scene.admin, 'resume', null)), 'accepted');
  assert.equal(reasonOf(await control(scene, scene.admin, 'resume', null)), 'accepted');
  assert.deepEqual(await flags(scene), { harness: false, lanes: [] });
}

async function refusals(scene: Scene): Promise<readonly string[]> {
  const editor = await simPerson(scene.world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const agent = simAgent(scene.admin, 'builder', { interactive: true });
  return [
    reasonOf(await control(scene, editor, 'pause', 'build')),
    reasonOf(await control(scene, editor, 'pause', null)),
    reasonOf(await control(scene, agent, 'pause', 'build')),
    reasonOf(await control(scene, agent, 'resume', null)),
    reasonOf(await control(scene, scene.admin, 'pause', 'nowhere')),
    reasonOf(
      await scene.world.kernel.stages.updateStage(simCaller(scene.world, scene.admin), {
        harnessId: scene.harnessId,
        stageKey: 'build',
        change: Object.fromEntries([['paused', true]]),
      }),
    ),
  ];
}

export const scenario = defineScenario({
  id: 'WB-1',
  title:
    'pause and resume record harness_paused and harness_resumed for a lane and for the harness, change the paused flags, and a repeat records nothing',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const scene = { world, harnessId: harness.id, admin };
    await lane(scene);
    await whole(scene);
    const refused = await refusals(scene);
    assert.deepEqual(refused, [
      'not_permitted',
      'not_permitted',
      'not_permitted',
      'not_permitted',
      'stage_not_found',
      'malformed_command',
    ]);
    const log = await controlLog(scene);
    assert.deepEqual(log, [
      ['harness_paused', 'build'],
      ['harness_resumed', 'build'],
      ['harness_paused', null],
      ['harness_resumed', null],
    ]);
    assert.deepEqual(await flags(scene), { harness: false, lanes: [] });
    return { state: { log, refused } };
  },
});
