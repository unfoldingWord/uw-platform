import type { CapabilityWord, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewriteDelegation, seedPage } from '@uw/db/test-seed';
import { software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simIan, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const learningId = '00000000-0000-4000-8000-000000008101';

type Delegations = { readonly live: string; readonly none: string; readonly other: string };

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly otherHarnessId: string;
  readonly itemId: string;
  readonly agent: Caller;
  readonly delegations: Delegations;
};

type Attempt = (scene: Scene, delegationId: string | null) => Promise<KernelOutcome<unknown>>;

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function delegate(
  world: World,
  kim: Principal,
  harnessId: string,
  capability: CapabilityWord,
): Promise<string> {
  const granted = await world.kernel.delegations.grant(simCaller(world, kim), {
    harnessId,
    persona: 'agent:builder',
    capability,
    expiresAt: null,
    supersedes: null,
  });
  return value(granted).id;
}

async function harnesses(world: World): Promise<readonly [string, string]> {
  const { harness } = await createSimHarness(world, software);
  const other = await createSimHarness(world, software, { key: 'other' });
  await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
    harnessId: harness.id,
    stageKey: 'package',
    change: { agentPickup: 'allowed' },
  });
  return [harness.id, other.harness.id];
}

async function sceneOf(world: World): Promise<Scene> {
  const [harnessId, otherHarnessId] = await harnesses(world);
  const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
  await seedPage(world.database.db, {
    id: learningId,
    type: 'learning',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'guard',
    title: 'Guard',
    bodyMd: '- [observed] one claim',
  });
  const item = await world.kernel.items.enqueue(simCaller(world, kim), {
    harnessId,
    title: 'Wire the board',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const delegations = {
    live: await delegate(world, kim, harnessId, 'iterate'),
    none: await delegate(world, kim, harnessId, 'none'),
    other: await delegate(world, kim, otherHarnessId, 'iterate'),
  };
  const agent = simCaller(world, simAgent(kim, 'builder', { interactive: false }));
  return { world, harnessId, otherHarnessId, itemId: value(item).itemId, agent, delegations };
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await sceneOf(world));
  } finally {
    await world.close();
  }
}

const presented: ReadonlyMap<string, Attempt> = new Map<string, Attempt>([
  [
    'claim',
    (scene, delegationId) =>
      scene.world.kernel.items.claim(scene.agent, { itemId: scene.itemId, delegationId }),
  ],
  [
    'enqueue',
    (scene, delegationId) =>
      scene.world.kernel.items.enqueue(scene.agent, {
        harnessId: scene.harnessId,
        title: 'Another',
        pageId: null,
        priority: 1,
        due: null,
        delegationId,
      }),
  ],
  [
    'attach a learning',
    (scene, delegationId) =>
      scene.world.kernel.items.attachLearning(scene.agent, {
        itemId: scene.itemId,
        pageId: learningId,
        delegationId,
      }),
  ],
]);

function reasonOf(outcome: KernelOutcome<unknown>): string {
  return outcome.status === 'error' ? outcome.reason : 'accepted';
}

async function refusesEveryUnboundDelegation(scene: Scene, attempt: Attempt): Promise<void> {
  const { none, other, live } = scene.delegations;
  const reasons = [
    reasonOf(await attempt(scene, none)),
    reasonOf(await attempt(scene, other)),
    reasonOf(await attempt(scene, null)),
  ];
  expect(reasons).toEqual(['not_permitted', 'not_permitted', 'delegation_required']);
  expect(reasonOf(await attempt(scene, live))).toBe('accepted');
}

describe('KN-16 a command that takes a delegation refuses one not bound to the agent, harness and a capability', () => {
  it.each([...presented.keys()])('%s', (name) =>
    inScene((scene) => {
      const attempt = presented.get(name);
      if (attempt === undefined) throw new Error(`no attempt ${name}`);
      return refusesEveryUnboundDelegation(scene, attempt);
    }),
  );
});

type HeldAttempt = (scene: Scene) => Promise<KernelOutcome<unknown>>;

const held: ReadonlyMap<string, HeldAttempt> = new Map<string, HeldAttempt>([
  [
    'release',
    (scene: Scene) =>
      scene.world.kernel.items.release(scene.agent, {
        itemId: scene.itemId,
        delegationId: scene.delegations.live,
      }),
  ],
  [
    'record a run step',
    (scene: Scene) =>
      scene.world.kernel.items.recordRunStep(scene.agent, {
        itemId: scene.itemId,
        runId: scene.world.adapters.ids.next(),
        step: 'read',
        tokensIn: 1,
        tokensOut: 1,
        costBasis: 'metered',
      }),
  ],
  [
    'submit',
    (scene: Scene) =>
      scene.world.kernel.items.submit(scene.agent, {
        itemId: scene.itemId,
        to: null,
        evidence: {},
        change: null,
      }),
  ],
]);

type Spoil = { readonly capability?: CapabilityWord; readonly harnessId?: string };

function spoiling(scene: Scene, which: 'none' | 'other'): Spoil {
  return which === 'none' ? { capability: 'none' } : { harnessId: scene.otherHarnessId };
}

async function refusedOnceSpoiled(name: string, which: 'none' | 'other'): Promise<void> {
  await inScene(async (scene) => {
    value(
      await scene.world.kernel.items.claim(scene.agent, {
        itemId: scene.itemId,
        delegationId: scene.delegations.live,
      }),
    );
    await rewriteDelegation(
      scene.world.database.db,
      scene.delegations.live,
      spoiling(scene, which),
    );
    const attempt = held.get(name);
    if (attempt === undefined) throw new Error(`no attempt ${name}`);
    expect(reasonOf(await attempt(scene))).toBe('not_permitted');
  });
}

async function releaseWithoutDelegation(scene: Scene): Promise<void> {
  value(
    await scene.world.kernel.items.claim(scene.agent, {
      itemId: scene.itemId,
      delegationId: scene.delegations.live,
    }),
  );
  const released = await scene.world.kernel.items.release(scene.agent, {
    itemId: scene.itemId,
    delegationId: null,
  });
  expect(released.status).toBe('error');
}

describe('KN-16 a command on a held item re-checks the delegation the item was claimed under', () => {
  it.each([...held.keys()])('%s is refused once the delegation is capability none', (name) =>
    refusedOnceSpoiled(name, 'none'),
  );

  it.each([...held.keys()])('%s is refused once the delegation is for another harness', (name) =>
    refusedOnceSpoiled(name, 'other'),
  );

  it('release by a bare agent that presents no delegation is refused', () =>
    inScene(releaseWithoutDelegation));
});
