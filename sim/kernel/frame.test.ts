import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller } from '../fixtures.ts';
import { runWorld, startOn, value } from '../runs.ts';
import { waitingScene, type Waiting } from '../views.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inScene(work: (scene: Waiting) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await waitingScene(world));
  } finally {
    await world.close();
  }
}

async function countsAgreeWithTheReads(scene: Waiting): Promise<void> {
  const { views } = scene.world.kernel;
  const caller = simCaller(scene.world, scene.owner);
  const frame = await views.frame(caller);
  const waiting = await views.waitingOn(simCaller(scene.world, scene.owner));
  const gates = await views.gates(simCaller(scene.world, scene.owner));
  expect(frame.waiting).toBe(waiting.rows.length + waiting.uncounted);
  expect(frame.waiting).toBeGreaterThan(0);
  expect(frame.gatesOpen).toBe(gates.rows.length);
  const open = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.openFor(scene.harnessId, 5000),
  );
  expect(frame.harnesses).toEqual([
    { harness: expect.objectContaining({ id: scene.harnessId }), open: open.length },
  ]);
}

async function workingAgentsCounted(): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await runWorld(world);
    const caller = () => simCaller(world, scene.owner);
    const before = await world.kernel.views.frame(caller());
    value(await startOn(scene));
    const after = await world.kernel.views.frame(caller());
    expect([before.agentsWorking, after.agentsWorking]).toEqual([0, 1]);
  } finally {
    await world.close();
  }
}

async function agentWaitsOnNothing(scene: Waiting): Promise<void> {
  const agent = simAgent(scene.owner, `${scene.owner.personId ?? ''}/laptop`, {
    interactive: true,
  });
  const frame = await scene.world.kernel.views.frame(simCaller(scene.world, agent));
  expect([frame.waiting, frame.gatesOpen]).toEqual([0, 0]);
}

describe('UI-5 the frame counts what waits, what is open and who is working', () => {
  it('UI-5 the counts agree with the waiting, gates and open-item reads', () =>
    inScene(countsAgreeWithTheReads));
  it('UI-5 a started run counts as an agent working', () => workingAgentsCounted());
  it('UI-5 nothing waits on an agent', () => inScene(agentWaitsOnNothing));
});
