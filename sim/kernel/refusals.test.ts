import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simParkedAtCheck, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly itemId: string;
  readonly ian: Principal;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = await simParkedAtCheck(world, { harnessId: harness.id, admin, title: 'Gate' });
    await work({ world, itemId: parked.itemId, ian: admin });
  } finally {
    await world.close();
  }
}

function approveAs(scene: Scene, actor: Principal) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, actor), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
}

async function refusalsOf(scene: Scene, reader: Principal) {
  return scene.world.kernel.views.refusals(simCaller(scene.world, reader), {
    itemIds: [scene.itemId],
  });
}

async function latestRefusalOutlivesLaterEvents(scene: Scene): Promise<void> {
  expect(await refusalsOf(scene, scene.ian)).toEqual([]);
  const agent = simAgent(scene.ian, 'reviewer', { interactive: true });
  await approveAs(scene, agent);
  const caller = simCaller(scene.world, scene.ian);
  await scene.world.kernel.gates.decide(caller, {
    itemId: scene.itemId,
    decision: 'take_over',
    reason: null,
    findings: [],
  });
  const last = await scene.world.kernel.views.lastEvents(caller, { itemIds: [scene.itemId] });
  expect(last.map((event) => event.name)).not.toEqual(['gate_refused_to_agent']);
  const shown = await refusalsOf(scene, scene.ian);
  expect(shown.map((event) => [event.itemId, event.name, event.actor])).toEqual([
    [scene.itemId, 'gate_refused_to_agent', agent.identity],
  ]);
}

async function unreadableShowsNothing(scene: Scene): Promise<void> {
  await approveAs(scene, simAgent(scene.ian, 'reviewer', { interactive: true }));
  const stranger = await simPerson(scene.world, 9, []);
  expect(await refusalsOf(scene, stranger)).toEqual([]);
}

describe('#105 the refusals shown on queue cards', () => {
  it('#105 an item shows its latest refusal to an agent', () =>
    inScene(latestRefusalOutlivesLaterEvents));
  it('#105 a person who cannot read the workflow sees no refusals', () =>
    inScene(unreadableShowsNothing));
});
