import { identitySchema, type CapabilityWord, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  readSpend,
  simAgent,
  simCaller,
  simDelegate,
  simPerson,
} from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const editor = [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }] as const;
const admin = [{ role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' }] as const;

type Scene = { readonly world: World; readonly harnessId: string; readonly itemId: string };

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'error' ? outcome.reason : 'accepted';
}

async function sceneOf(world: World, enqueuer: Principal): Promise<Scene> {
  const { harness, admin: ian } = await createSimHarness(world, software);
  await readSpend(world);
  await world.kernel.stages.updateStage(simCaller(world, ian), {
    harnessId: harness.id,
    stageKey: 'package',
    change: { agentPickup: 'allowed', bracket: 'iterate' },
  });
  const item = await world.kernel.items.enqueue(simCaller(world, enqueuer), {
    harnessId: harness.id,
    title: 'Wire the board',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  return { world, harnessId: harness.id, itemId: value(item).itemId };
}

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

function eventCount(scene: Scene): Promise<number> {
  return scene.world.adapters.store
    .transaction((tx) => readAllEvents(tx, scene.harnessId, null))
    .then((events) => events.length);
}

function holderOf(scene: Scene): Promise<string | null> {
  return scene.world.adapters.store
    .transaction((tx) => tx.harnessItems.read.byId(scene.itemId))
    .then((item) => item?.holder ?? null);
}

function crafted(a: Principal, b: Principal): Principal {
  return {
    identity: identitySchema.parse(`agent:${b.personId ?? ''}/laptop`),
    kind: 'agent',
    personId: a.personId,
    email: null,
    grants: a.grants,
    interactive: true,
  };
}

type People = { readonly a: Principal; readonly b: Principal };

async function people(world: World): Promise<People> {
  return { a: await simPerson(world, 4, editor), b: await simPerson(world, 5, editor) };
}

async function craftedClaimRefused(world: World): Promise<void> {
  const { a, b } = await people(world);
  const scene = await sceneOf(world, a);
  const before = await eventCount(scene);
  const outcome = await world.kernel.items.claim(simCaller(world, crafted(a, b)), {
    itemId: scene.itemId,
    delegationId: null,
  });
  expect(outcome).toEqual({
    status: 'error',
    reason: 'not_permitted',
    detail: { why: 'owner_mismatch' },
  });
  expect(await eventCount(scene)).toBe(before);
  expect(await holderOf(scene)).toBeNull();
}

type Attempt = () => Promise<KernelOutcome<unknown>>;

function heldAttempts(scene: Scene, as: Caller): readonly Attempt[] {
  const { items } = scene.world.kernel;
  return [
    () => items.release(as, { itemId: scene.itemId, delegationId: null }),
    () =>
      items.recordRunStep(as, {
        itemId: scene.itemId,
        runId: scene.world.adapters.ids.next(),
        step: 'read',
        tokensIn: 1,
        tokensOut: 1,
        costBasis: 'subscription',
      }),
    () => items.submit(as, { itemId: scene.itemId, to: null, evidence: {}, change: null }),
  ];
}

async function craftedCannotTouchHeldItem(world: World): Promise<void> {
  const { a, b } = await people(world);
  const scene = await sceneOf(world, a);
  const device = simAgent(b, `${b.personId ?? ''}/laptop`, { interactive: true });
  value(
    await world.kernel.items.claim(simCaller(world, device), {
      itemId: scene.itemId,
      delegationId: null,
    }),
  );
  const as = simCaller(world, crafted(a, b));
  for (const attempt of heldAttempts(scene, as)) {
    expect(['not_holder', 'not_permitted']).toContain(reasonOf(await attempt()));
  }
  expect(await holderOf(scene)).toBe(device.identity);
}

describe("AB-2 the kernel refuses a device identity that is not its owner's", () => {
  it("a device naming another person's segment is not_permitted on claim and logs nothing", () =>
    inWorld(craftedClaimRefused));

  it("that identity cannot release, step or submit the item the owner's own device holds", () =>
    inWorld(craftedCannotTouchHeldItem));
});

async function delegate(
  world: World,
  granter: Principal,
  harnessId: string,
  persona: string,
): Promise<string> {
  const capability: CapabilityWord = 'iterate';
  const granted = await simDelegate(world, granter, {
    harnessId,
    persona,
    capability,
    expiresAt: null,
    supersedes: null,
  });
  return value(granted).id;
}

type Foreign = {
  readonly scene: Scene;
  readonly k: Principal;
  readonly l: Principal;
  readonly kims: string;
};

async function foreignScene(world: World): Promise<Foreign> {
  const k = await simPerson(world, 6, admin);
  const l = await simPerson(world, 7, admin);
  const scene = await sceneOf(world, k);
  const kims = await delegate(world, k, scene.harnessId, 'agent:iterate');
  return { scene, k, l, kims };
}

async function claimAs(scene: Scene, actor: Principal, delegationId: string) {
  return scene.world.kernel.items.claim(simCaller(scene.world, actor), {
    itemId: scene.itemId,
    delegationId,
  });
}

async function foreignReadsAsUnknown(world: World, revokeFirst: boolean): Promise<void> {
  const { scene, k, l, kims } = await foreignScene(world);
  if (revokeFirst) {
    value(await world.kernel.delegations.revoke(simCaller(world, k), { delegationId: kims }));
  }
  const lAgent = simAgent(l, 'iterate', { interactive: false });
  const before = await eventCount(scene);
  const unknownId = world.adapters.ids.next();
  const foreign = await claimAs(scene, lAgent, kims);
  const unknown = await claimAs(scene, lAgent, unknownId);
  expect(foreign).toEqual({
    status: 'error',
    reason: 'delegation_not_found',
    detail: { delegationId: kims },
  });
  expect(unknown).toEqual({ ...foreign, detail: { delegationId: unknownId } });
  expect(await eventCount(scene)).toBe(before);
}

async function ownPersonaMismatchRefused(world: World): Promise<void> {
  const { scene, k } = await foreignScene(world);
  const builders = await delegate(world, k, scene.harnessId, 'agent:builder');
  const kAgent = simAgent(k, 'iterate', { interactive: false });
  expect(reasonOf(await claimAs(scene, kAgent, builders))).toBe('not_permitted');
}

describe('AB-6 a delegation id that belongs to someone else reads as one that does not exist', () => {
  it("another person's live delegation is delegation_not_found like an unknown id, with no event", () =>
    inWorld((world) => foreignReadsAsUnknown(world, false)));

  it("another person's revoked delegation is the same reply and writes no delegation_lapsed", () =>
    inWorld((world) => foreignReadsAsUnknown(world, true)));

  it('the owner presenting a delegation for another persona is still not_permitted', () =>
    inWorld(ownPersonaMismatchRefused));
});

type Named = {
  readonly scene: Scene;
  readonly delegated: Caller;
  readonly own: string;
  readonly another: string;
};

async function namedScene(world: World): Promise<Named> {
  const a = await simPerson(world, 4, admin);
  const scene = await sceneOf(world, a);
  const own = await delegate(world, a, scene.harnessId, 'agent:builder');
  const another = await delegate(world, a, scene.harnessId, 'agent:builder');
  const device = `${a.personId ?? ''}/laptop as builder via delegation:${own}`;
  const delegated = simCaller(world, simAgent(a, device, { interactive: true }));
  return { scene, delegated, own, another };
}

function mismatch(delegationId: string | null): KernelOutcome<never> {
  return {
    status: 'error',
    reason: 'not_permitted',
    detail: { delegationId, why: 'delegation_mismatch' },
  };
}

async function claimMustPresentItsOwn(world: World): Promise<void> {
  const { scene, delegated, own, another } = await namedScene(world);
  const before = await eventCount(scene);
  const claim = (delegationId: string | null) =>
    world.kernel.items.claim(delegated, { itemId: scene.itemId, delegationId });
  expect(await claim(null)).toEqual(mismatch(null));
  expect(await claim(another)).toEqual(mismatch(another));
  expect(await eventCount(scene)).toBe(before);
  expect(await holderOf(scene)).toBeNull();
  expect(reasonOf(await claim(own))).toBe('accepted');
}

async function enqueueMustPresentItsOwn(world: World): Promise<void> {
  const { scene, delegated, own } = await namedScene(world);
  const enqueue = (delegationId: string | null) =>
    world.kernel.items.enqueue(delegated, {
      harnessId: scene.harnessId,
      title: 'Another',
      pageId: null,
      priority: 1,
      due: null,
      delegationId,
    });
  expect(await enqueue(null)).toEqual(mismatch(null));
  expect(reasonOf(await enqueue(own))).toBe('accepted');
}

describe('AB-6 an identity that names a delegation acts only under that delegation', () => {
  it('claiming with no delegation id or with another live one for its persona is not_permitted', () =>
    inWorld(claimMustPresentItsOwn));

  it('enqueueing with no delegation id is not_permitted', () => inWorld(enqueueMustPresentItsOwn));
});
