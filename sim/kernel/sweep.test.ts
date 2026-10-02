import { principalSchema, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { LEASE_MS, software, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson, simSystem } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly admin: Principal; readonly itemId: string };

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function lapsedScene(world: World): Promise<Scene> {
  const { harness, admin } = await createSimHarness(world, software);
  const max = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const item = value(
    await world.kernel.items.enqueue(simCaller(world, max), {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    }),
  );
  await world.kernel.stages.updateStage(simCaller(world, admin), {
    harnessId: harness.id,
    stageKey: 'package',
    change: { agentPickup: 'allowed' },
  });
  const device = simAgent(max, `${max.personId}/laptop`, { interactive: true });
  value(
    await world.kernel.items.claim(simCaller(world, device), {
      itemId: item.itemId,
      delegationId: null,
    }),
  );
  world.adapters.clock.advance(LEASE_MS + 1000);
  return { world, admin, itemId: item.itemId };
}

async function withLapse(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await lapsedScene(world));
  } finally {
    await world.close();
  }
}

function sweepAs(scene: Scene, actor: Principal) {
  return scene.world.kernel.items.expireLeases(simCaller(scene.world, actor), { limit: 10 });
}

function lookalikes(admin: Principal): readonly Principal[] {
  const system = simSystem();
  return [
    admin,
    simAgent(admin, 'system', { interactive: false }),
    principalSchema.parse({ ...system, grants: admin.grants }),
    principalSchema.parse({ ...system, interactive: true }),
  ];
}

async function refusesAllButSystem(scene: Scene): Promise<void> {
  for (const actor of lookalikes(scene.admin)) {
    expect(await sweepAs(scene, actor)).toMatchObject({ status: 'error', reason: 'not_permitted' });
  }
  expect(value(await sweepAs(scene, simSystem())).expired).toEqual([scene.itemId]);
}

describe('the lease sweep is platform maintenance that only the system principal runs', () => {
  it('refuses an org admin and every look-alike of the system principal, and sweeps as it', () =>
    withLapse(refusesAllButSystem));
});
