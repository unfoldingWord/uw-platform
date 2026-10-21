import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewriteItem } from '@uw/db/test-seed';
import type { ItemState } from '@uw/contracts';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly items: readonly ItemState[];
  readonly editor: Awaited<ReturnType<typeof simPerson>>;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    value(
      await world.kernel.stages.updateStage(simCaller(world, admin), {
        harnessId: harness.id,
        stageKey: 'package',
        change: { agentPickup: 'allowed' },
      }),
    );
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items } = value(await enqueueEpicAs(world, admin, harness.id));
    const editor = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    await work({ world, harnessId: harness.id, items, editor });
  } finally {
    await world.close();
  }
}

function agentOf(scene: Scene, name: string) {
  const agent = simAgent(scene.editor, `${scene.editor.personId ?? ''}/${name}`, {
    interactive: true,
  });
  return simCaller(scene.world, agent);
}

async function offered(scene: Scene, caller = agentOf(scene, 'poller')) {
  const polled = await scene.world.kernel.reads.poll(caller, {
    harnessId: scene.harnessId,
    limit: 10,
  });
  return value(polled).map((item) => item.itemId);
}

function idOf(scene: Scene, index: number): string {
  return scene.items[index]?.itemId ?? '';
}

async function leftOut(scene: Scene): Promise<void> {
  expect(await offered(scene)).toEqual([idOf(scene, 0), idOf(scene, 1), idOf(scene, 2)]);
  const byPerson = await offered(scene, simCaller(scene.world, scene.editor));
  expect(byPerson).not.toContain(idOf(scene, 3));
}

async function offeredOnceDone(scene: Scene): Promise<void> {
  await rewriteItem(scene.world.database.db, idOf(scene, 2), { gateStatus: 'done' });
  expect(await offered(scene)).toContain(idOf(scene, 3));
}

async function claimRefused(scene: Scene): Promise<void> {
  const claim = { itemId: idOf(scene, 3), delegationId: null };
  const byAgent = await scene.world.kernel.items.claim(agentOf(scene, 'builder'), claim);
  expect(reasonOf(byAgent)).toBe('not_permitted');
  expect(byAgent.status === 'error' && byAgent.detail).toMatchObject({
    why: 'blocked',
    blockers: [idOf(scene, 2)],
  });
  const byPerson = await scene.world.kernel.items.claim(
    simCaller(scene.world, scene.editor),
    claim,
  );
  expect(byPerson.status).toBe('accepted');
}

describe('EI-3 a blocked item is not offered until every blocker’s item has passed Ship', () => {
  it('leaves the blocked item out of poll_queue for agents and people', () => inScene(leftOut));

  it('offers it once the blocker’s item is done, as the views tests plant a gate status', () =>
    inScene(offeredOnceDone));

  it('refuses an agent’s claim of a blocked item by id, and lets a person claim it', () =>
    inScene(claimRefused));
});
