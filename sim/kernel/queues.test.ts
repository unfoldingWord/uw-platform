import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { bml } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { waitingScene, type Waiting } from '../views.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inScene(work: (scene: Waiting, elsewhere: string) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await waitingScene(world);
    const { harness } = await createSimHarness(world, bml, { jdArea: '30-39' });
    await work(scene, harness.id);
  } finally {
    await world.close();
  }
}

async function cardsAgreeWithTheReads(scene: Waiting): Promise<void> {
  const { views } = scene.world.kernel;
  const caller = simCaller(scene.world, scene.owner);
  const { cards } = await views.queues(caller);
  const gates = await views.gates(caller);
  const open = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.openFor(scene.harnessId, 5000),
  );
  const card = cards.find((shown) => shown.harness.id === scene.harnessId);
  expect(card?.waiting).toBe(gates.rows.length);
  expect(card?.waiting).toBeGreaterThan(0);
  expect(card?.open).toBe(open.length);
  expect(card?.phases.map((phase) => phase.phase)).toEqual([
    'product_package',
    'build_package',
    'deploy_package',
    'iterate',
  ]);
  expect(card?.phases.reduce((sum, phase) => sum + phase.count, 0)).toBe(open.length);
  expect(card?.oldestEnteredAt).toBeInstanceOf(Date);
}

async function grantsDecideWhatIsListed(scene: Waiting, elsewhere: string): Promise<void> {
  const { views } = scene.world.kernel;
  const listed = async (caller: ReturnType<typeof simCaller>) =>
    (await views.queues(caller)).cards.map((card) => card.harness.id).sort();
  const viewer = await simPerson(scene.world, 8, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const nobody = await simPerson(scene.world, 9, []);
  expect(await listed(simCaller(scene.world, viewer))).toEqual([scene.harnessId]);
  expect(await listed(simCaller(scene.world, scene.editor))).toEqual(
    [scene.harnessId, elsewhere].sort(),
  );
  expect(await listed(simCaller(scene.world, nobody))).toEqual([]);
}

async function editorsDecideNothing(scene: Waiting): Promise<void> {
  const { cards } = await scene.world.kernel.views.queues(simCaller(scene.world, scene.editor));
  expect(cards.map((card) => card.waiting)).toEqual([0, 0]);
}

describe('#104 the Agent Queues landing page lists the workflows a person may see', () => {
  it('#104 each card agrees with the open-item and gate reads', () =>
    inScene(cardsAgreeWithTheReads));
  it('#104 a viewer sees their own area, an editor every area, no grant nothing', () =>
    inScene(grantsDecideWhatIsListed));
  it('#104 only gates the viewer may decide count as waiting on them', () =>
    inScene(editorsDecideNothing));
});
