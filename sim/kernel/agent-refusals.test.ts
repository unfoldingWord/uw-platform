import { identitySchema, type HarnessEvent, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simParkedAtCheck, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const parked = await simParkedAtCheck(world, { harnessId: harness.id, admin, title: 'Gate' });
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin });
  } finally {
    await world.close();
  }
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'error' ? outcome.reason : 'accepted';
}

function eventsOf(scene: Scene): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
}

function approveAs(scene: Scene, actor: Principal) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, actor), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
}

async function unreadableAgentSeesNoItem(scene: Scene): Promise<void> {
  const elsewhere = await simPerson(scene.world, 3, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  const before = await eventsOf(scene);
  const outcome = await approveAs(scene, simAgent(elsewhere, 'reviewer', { interactive: true }));
  expect(outcome).toMatchObject({ status: 'error', reason: 'item_not_found' });
  expect(await eventsOf(scene)).toEqual(before);
}

async function readableAgentIsRefusedAsAgent(scene: Scene): Promise<void> {
  const viewer = await simPerson(scene.world, 3, [{ role: 'viewer', ...area }]);
  const outcome = await approveAs(scene, simAgent(viewer, 'reviewer', { interactive: true }));
  expect(reasonOf(outcome)).toBe('gate_refused_to_agent');
  expect((await eventsOf(scene)).at(-1)?.name).toBe('gate_refused_to_agent');
}

describe('KN-13 an agent that cannot read the harness learns nothing about the item', () => {
  it('answers item_not_found and records no event', () => inScene(unreadableAgentSeesNoItem));

  it('records gate_refused_to_agent for an agent that can read it', () =>
    inScene(readableAgentIsRefusedAsAgent));
});

function personKindAgent(owner: Principal): Principal {
  return { ...owner, kind: 'person', identity: identitySchema.parse('agent:builder') };
}

async function takeOverAsIan(scene: Scene): Promise<void> {
  const outcome = await scene.world.kernel.gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision: 'take_over',
    reason: null,
    findings: [],
  });
  if (outcome.status !== 'accepted') throw new Error(`take over refused: ${outcome.reason}`);
}

async function crafted(scene: Scene): Promise<readonly string[]> {
  const caller = simCaller(scene.world, personKindAgent(scene.ian));
  const { kernel } = scene.world;
  const stage = await kernel.stages.updateStage(caller, {
    harnessId: scene.harnessId,
    stageKey: 'build',
    change: { title: 'Changed' },
  });
  const repair = await kernel.repair.rebuildItem(caller, { itemId: scene.itemId });
  await takeOverAsIan(scene);
  const release = await kernel.items.release(caller, { itemId: scene.itemId, delegationId: null });
  return [reasonOf(stage), reasonOf(repair), reasonOf(release)];
}

describe('an agent identity is an agent whatever its kind field says', () => {
  it('is refused the stage command, the repair and the admin release override', () =>
    inScene(async (scene) => {
      expect(await crafted(scene)).toEqual(['not_permitted', 'not_permitted', 'not_holder']);
    }));
});

async function revokedAdminCannotOverride(scene: Scene): Promise<void> {
  await takeOverAsIan(scene);
  const kim = await simPerson(scene.world, 4, [{ role: 'admin', ...area }]);
  await revokeSeededGrant(
    scene.world.database.db,
    '00000000-0000-4000-8000-000000020400',
    scene.world.adapters.clock.now(),
  );
  scene.world.adapters.clock.advance(1000);
  const outcome = await scene.world.kernel.items.release(simCaller(scene.world, kim), {
    itemId: scene.itemId,
    delegationId: null,
  });
  expect(reasonOf(outcome)).toBe('not_holder');
}

describe('the admin release override reads the admin grant again inside its transaction', () => {
  it('refuses a stale principal whose admin grant was revoked', () =>
    inScene(revokedAdminCannotOverride));
});
