import { delegatedIdentity, principalSchema, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { software, type Caller, type KernelOutcome, type PollItem } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly ian: Principal;
  readonly firstId: string;
  readonly secondId: string;
  readonly firstItem: string;
  readonly secondItem: string;
};

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'error' ? outcome.reason : 'accepted';
}

async function openPackage(world: World, ian: Principal, harnessId: string): Promise<string> {
  const caller = simCaller(world, ian);
  value(
    await world.kernel.stages.updateStage(caller, {
      harnessId,
      stageKey: 'package',
      change: { agentPickup: 'allowed' },
    }),
  );
  const item = await world.kernel.items.enqueue(caller, {
    harnessId,
    title: 'Wire the board',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  return value(item).itemId;
}

async function sceneOf(world: World): Promise<Scene> {
  const first = await createSimHarness(world, software);
  const second = await createSimHarness(world, software, { key: 'software-two', jdArea: '30-39' });
  const ian = first.admin;
  return {
    world,
    ian,
    firstId: first.harness.id,
    secondId: second.harness.id,
    firstItem: await openPackage(world, ian, first.harness.id),
    secondItem: await openPackage(world, ian, second.harness.id),
  };
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await sceneOf(world));
  } finally {
    await world.close();
  }
}

async function delegate(scene: Scene, by: Principal, persona: string): Promise<string> {
  const granted = await scene.world.kernel.delegations.grant(simCaller(scene.world, by), {
    harnessId: scene.firstId,
    persona,
    capability: 'iterate',
    expiresAt: null,
    supersedes: null,
  });
  return value(granted).id;
}

async function revoke(scene: Scene, delegationId: string): Promise<void> {
  value(
    await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.ian), {
      delegationId,
    }),
  );
}

function polled(scene: Scene, actor: Principal): Promise<KernelOutcome<readonly PollItem[]>> {
  return scene.world.kernel.reads.poll(simCaller(scene.world, actor), {
    harnessId: null,
    limit: 10,
  });
}

async function idsPolled(scene: Scene, actor: Principal): Promise<readonly string[]> {
  return value(await polled(scene, actor)).map((item) => item.itemId);
}

function delegatedDevice(owner: Principal, persona: string, delegationId: string): Principal {
  return principalSchema.parse({
    ...owner,
    identity: delegatedIdentity(`agent:${owner.personId ?? ''}/laptop`, persona, delegationId),
    kind: 'agent',
    email: null,
    interactive: true,
  });
}

async function lapseNames(scene: Scene): Promise<readonly string[]> {
  const page = await scene.world.kernel.events.read(simCaller(scene.world, scene.ian), {
    harnessId: scene.firstId,
    itemId: null,
    after: 0,
    limit: 100,
  });
  return value(page)
    .events.map((event) => event.name)
    .filter((name) => name === 'delegation_lapsed');
}

async function barePersona(scene: Scene): Promise<void> {
  const iterate = simAgent(scene.ian, 'iterate', { interactive: false });
  const laptop = simAgent(scene.ian, `${scene.ian.personId ?? ''}/laptop`, { interactive: true });
  expect(await idsPolled(scene, laptop)).toEqual([scene.firstItem, scene.secondItem].sort());
  expect(await idsPolled(scene, iterate)).toEqual([]);
  const delegationId = await delegate(scene, scene.ian, 'agent:iterate');
  expect(await idsPolled(scene, iterate)).toEqual([scene.firstItem]);
  await revoke(scene, delegationId);
  expect(await idsPolled(scene, iterate)).toEqual([]);
}

async function delegatedForm(scene: Scene): Promise<void> {
  const delegationId = await delegate(scene, scene.ian, 'agent:iterate');
  const device = delegatedDevice(scene.ian, 'iterate', delegationId);
  expect(await idsPolled(scene, device)).toEqual([scene.firstItem]);
  const builder = await delegate(scene, scene.ian, 'agent:builder');
  expect(reasonOf(await polled(scene, delegatedDevice(scene.ian, 'iterate', builder)))).toBe(
    'not_permitted',
  );
  await revoke(scene, delegationId);
  const before = await lapseNames(scene);
  expect(reasonOf(await polled(scene, device))).toBe('delegation_lapsed');
  expect(await lapseNames(scene)).toEqual(before);
}

async function foreignDelegation(scene: Scene): Promise<void> {
  const kim = await simPerson(scene.world, 4, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const kims = await delegate(scene, kim, 'agent:iterate');
  const missing = '00000000-0000-4000-8000-000000009999';
  for (const delegationId of [kims, missing]) {
    expect(await polled(scene, delegatedDevice(scene.ian, 'iterate', delegationId))).toEqual({
      status: 'error',
      reason: 'delegation_not_found',
      detail: { delegationId },
    });
  }
}

describe('AB-4 a persona polls only the harnesses its live delegations name', () => {
  it('a bare persona polls the harness of its live delegation, and nothing once it is revoked', () =>
    inScene(barePersona));
  it('a delegated device polls its delegation harness, and is refused once it lapses without an event', () =>
    inScene(delegatedForm));
  it('a delegated device naming another person’s delegation is refused as not found', () =>
    inScene(foreignDelegation));
});

type Reader = (scene: Scene, caller: Caller) => Promise<KernelOutcome<unknown>>;

const readers: ReadonlyMap<string, readonly [Reader, string]> = new Map<
  string,
  readonly [Reader, string]
>([
  [
    'harness',
    [(s, c) => s.world.kernel.reads.harness(c, { harnessId: s.firstId }), 'harness_not_found'],
  ],
  ['item', [(s, c) => s.world.kernel.reads.item(c, { itemId: s.firstItem }), 'item_not_found']],
  [
    'inStage',
    [
      (s, c) => s.world.kernel.reads.inStage(c, { harnessId: s.firstId, stageKey: 'package' }),
      'harness_not_found',
    ],
  ],
]);

async function hides(scene: Scene, name: string): Promise<void> {
  const entry = readers.get(name);
  if (entry === undefined) throw new Error(`no reader ${name}`);
  const [read, hidden] = entry;
  const outsider = await simPerson(scene.world, 5, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '30-39' },
  ]);
  const insider = await simPerson(scene.world, 6, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  expect(reasonOf(await read(scene, simCaller(scene.world, outsider)))).toBe(hidden);
  expect(reasonOf(await read(scene, simCaller(scene.world, insider)))).toBe('accepted');
}

async function scenes(scene: Scene): Promise<void> {
  const caller = simCaller(scene.world, scene.ian);
  const { reads } = scene.world.kernel;
  const harness = value(await reads.harness(caller, { harnessId: scene.firstId }));
  expect(harness.stages.map((stage) => stage.key)).toContain('package');
  const item = value(await reads.item(caller, { itemId: scene.firstItem }));
  expect([item.harness.id, item.stage.key, item.item.itemId]).toEqual([
    scene.firstId,
    'package',
    scene.firstItem,
  ]);
  const staged = value(
    await reads.inStage(caller, { harnessId: scene.firstId, stageKey: 'package' }),
  );
  expect(staged.map((row) => row.itemId)).toEqual([scene.firstItem]);
  const missingStage = await reads.inStage(caller, {
    harnessId: scene.firstId,
    stageKey: 'nowhere',
  });
  expect(reasonOf(missingStage)).toBe('stage_not_found');
  const missingItem = await reads.item(caller, { itemId: '00000000-0000-4000-8000-000000009999' });
  expect(reasonOf(missingItem)).toBe('item_not_found');
}

describe('the kernel reads hide what the caller may not see', () => {
  it.each([...readers.keys()])('%s', (name) => inScene((scene) => hides(scene, name)));
  it('answers a harness, an item and a stage to a caller who may read them', () => inScene(scenes));
});
