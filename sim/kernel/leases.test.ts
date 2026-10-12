import type { HarnessEvent, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { revokeSeededGrant } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  readSpend,
  simAgent,
  simCaller,
  simDelegate,
  simIan,
  simPerson,
} from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly kim: Principal;
  readonly max: Principal;
};

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    await readSpend(world);
    await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      stageKey: 'package',
      change: { agentPickup: 'allowed', bracket: 'iterate' },
    });
    const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
    const max = await simPerson(world, 6, [{ role: 'editor', ...area }]);
    const item = value(
      await world.kernel.items.enqueue(simCaller(world, max), {
        harnessId: harness.id,
        title: 'Wire the board',
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    await work({ world, harnessId: harness.id, itemId: item.itemId, kim, max });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function deviceAgent(scene: Scene, owner: Principal, name: string): Caller {
  return simCaller(
    scene.world,
    simAgent(owner, `${owner.personId}/${name}`, { interactive: true }),
  );
}

function stepAs(scene: Scene, caller: Caller) {
  return scene.world.kernel.items.recordRunStep(caller, {
    itemId: scene.itemId,
    runId: scene.world.adapters.ids.next(),
    step: 'read',
    tokensIn: 1,
    tokensOut: 1,
    costBasis: 'subscription',
  });
}

function eventsOf(scene: Scene): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
}

async function claimBare(scene: Scene): Promise<{ caller: Caller; delegationId: string }> {
  const delegation = value(
    await simDelegate(scene.world, scene.kim, {
      harnessId: scene.harnessId,
      persona: 'agent:builder',
      capability: 'iterate',
      expiresAt: null,
      supersedes: null,
    }),
  );
  const caller = simCaller(scene.world, simAgent(scene.kim, 'builder', { interactive: false }));
  value(
    await scene.world.kernel.items.claim(caller, {
      itemId: scene.itemId,
      delegationId: delegation.id,
    }),
  );
  return { caller, delegationId: delegation.id };
}

describe('KN-5 only the agent holder renews a lease', () => {
  sceneIt('refuses a renewal from a caller who is not the holder', async (scene) => {
    value(
      await scene.world.kernel.items.claim(deviceAgent(scene, scene.max, 'builder'), {
        itemId: scene.itemId,
        delegationId: null,
      }),
    );
    const other = deviceAgent(scene, scene.kim, 'reviewer');
    const renewed = await scene.world.kernel.items.renewLease(other, { itemId: scene.itemId });
    expect(reasonOf(renewed)).toBe('not_holder');
    expect(reasonOf(await stepAs(scene, other))).toBe('not_holder');
  });

  sceneIt('refuses a renewal from a person holder, who has no lease', async (scene) => {
    const person = simCaller(scene.world, scene.max);
    value(
      await scene.world.kernel.items.claim(person, { itemId: scene.itemId, delegationId: null }),
    );
    const renewed = await scene.world.kernel.items.renewLease(person, { itemId: scene.itemId });
    expect(reasonOf(renewed)).toBe('not_holder');
  });

  sceneIt('refuses an unknown item', async (scene) => {
    const renewed = await scene.world.kernel.items.renewLease(
      deviceAgent(scene, scene.max, 'builder'),
      { itemId: scene.world.adapters.ids.next() },
    );
    expect(reasonOf(renewed)).toBe('item_not_found');
  });

  sceneIt('renews a lease and records lease_renewed', async (scene) => {
    const builder = deviceAgent(scene, scene.max, 'builder');
    value(
      await scene.world.kernel.items.claim(builder, { itemId: scene.itemId, delegationId: null }),
    );
    scene.world.adapters.clock.advance(60_000);
    const renewed = value(
      await scene.world.kernel.items.renewLease(builder, { itemId: scene.itemId }),
    );
    expect(renewed.leaseWarning).toBe(false);
    const names = (await eventsOf(scene)).map((event) => event.name);
    expect(names).toEqual(['item_created', 'item_claimed', 'lease_renewed']);
  });
});

describe('KN-16 a step under a delegation re-checks it', () => {
  sceneIt('refuses once the grant is revoked and writes one delegation_lapsed', async (scene) => {
    const { caller } = await claimBare(scene);
    const adminGrant = scene.kim.grants[0];
    if (adminGrant === undefined) throw new Error('kim has no grant');
    const at = scene.world.adapters.clock.now();
    await revokeSeededGrant(scene.world.database.db, adminGrant.grantId, at);
    const first = await stepAs(scene, caller);
    const second = await stepAs(scene, caller);
    expect([reasonOf(first), reasonOf(second)]).toEqual(['delegation_lapsed', 'delegation_lapsed']);
    const all = await scene.world.adapters.store.transaction((tx) =>
      readAllEvents(tx, scene.harnessId, null),
    );
    const lapses = all.filter((event) => event.name === 'delegation_lapsed');
    expect(lapses).toHaveLength(1);
  });

  sceneIt('lets a step under a live delegation renew the lease', async (scene) => {
    const { caller } = await claimBare(scene);
    const outcome = value(await stepAs(scene, caller));
    expect(outcome.leaseWarning).toBe(false);
  });
});
