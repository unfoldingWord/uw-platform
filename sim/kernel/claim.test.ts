import type { HarnessEvent, ItemState, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import {
  bml,
  expireLapsedLease,
  readAllEvents,
  software,
  type Caller,
  type KernelOutcome,
} from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simIan, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const minute = 60_000;
const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly kim: Principal;
  readonly max: Principal;
};

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      stageKey: 'package',
      change: { agentPickup: 'allowed' },
    });
    const kim = await simPerson(world, 4, [{ role: 'admin', ...area }]);
    const max = await simPerson(world, 6, [{ role: 'editor', ...area }]);
    const enqueued = await world.kernel.items.enqueue(simCaller(world, max), {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    });
    const item = value(enqueued);
    await work({ world, harnessId: harness.id, itemId: item.itemId, kim, max });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

function agentCaller(
  scene: Scene,
  owner: Principal,
  persona: string,
  interactive: boolean,
): Caller {
  return simCaller(scene.world, simAgent(owner, persona, { interactive }));
}

function claimAs(scene: Scene, caller: Caller, delegationId: string | null = null) {
  return scene.world.kernel.items.claim(caller, { itemId: scene.itemId, delegationId });
}

function delegate(scene: Scene, harnessId = scene.harnessId, persona = 'agent:builder') {
  return scene.world.kernel.delegations
    .grant(simCaller(scene.world, scene.kim), {
      harnessId,
      persona,
      capability: 'iterate',
      expiresAt: null,
      supersedes: null,
    })
    .then((outcome) => value(outcome).id);
}

async function eventsOf(scene: Scene): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
}

async function namesOf(scene: Scene): Promise<readonly string[]> {
  return (await eventsOf(scene)).map((event) => event.name);
}

function itemOf(scene: Scene): Promise<ItemState | null> {
  return scene.world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(scene.itemId));
}

describe('KN-5 who may claim', () => {
  sceneIt('refuses a viewer', async (scene) => {
    const viewer = await simPerson(scene.world, 7, [{ role: 'viewer', ...area }]);
    const outcome = await claimAs(scene, simCaller(scene.world, viewer));
    expect(reasonOf(outcome)).toBe('not_permitted');
    expect((await itemOf(scene))?.holder).toBeNull();
  });

  sceneIt('refuses an unknown item', async (scene) => {
    const outcome = await scene.world.kernel.items.claim(simCaller(scene.world, scene.max), {
      itemId: scene.world.adapters.ids.next(),
      delegationId: null,
    });
    expect(reasonOf(outcome)).toBe('item_not_found');
  });

  sceneIt('refuses a parked item', async (scene) => {
    const caller = simCaller(scene.world, scene.max);
    const parked = { gateStatus: 'parked' } as const;
    await scene.world.adapters.store.transaction(async (tx) => {
      const item = await tx.harnessItems.read.byId(scene.itemId);
      if (item !== null) await tx.harnessItems.write.project({ ...item, ...parked });
    });
    const outcome = await claimAs(scene, caller);
    expect(outcome).toMatchObject({ reason: 'not_permitted', detail: { why: 'parked' } });
  });
});

describe('KN-16 a claim under a delegation checks it', () => {
  sceneIt(
    'refuses a non-interactive agent without one and records delegation_required',
    async (scene) => {
      const outcome = await claimAs(scene, agentCaller(scene, scene.kim, 'builder', false));
      expect(reasonOf(outcome)).toBe('delegation_required');
      expect(await namesOf(scene)).toEqual(['item_created', 'delegation_required']);
      expect((await itemOf(scene))?.holder).toBeNull();
    },
  );

  sceneIt('records the delegation id on the item and on item_claimed', async (scene) => {
    const delegationId = await delegate(scene);
    const outcome = await claimAs(
      scene,
      agentCaller(scene, scene.kim, 'builder', false),
      delegationId,
    );
    expect(value(outcome).item.delegationId).toBe(delegationId);
    const claimed = (await eventsOf(scene)).find((event) => event.name === 'item_claimed');
    expect(claimed?.evidence).toMatchObject({ holder: 'agent:builder', delegationId });
  });

  sceneIt('refuses a lapsed delegation and writes one delegation_lapsed', async (scene) => {
    const delegationId = await delegate(scene);
    await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.kim), {
      delegationId,
    });
    const caller = agentCaller(scene, scene.kim, 'builder', false);
    const first = await claimAs(scene, caller, delegationId);
    const second = await claimAs(scene, caller, delegationId);
    expect([reasonOf(first), reasonOf(second)]).toEqual(['delegation_lapsed', 'delegation_lapsed']);
    const lapses = await scene.world.adapters.store.transaction((tx) =>
      readAllEvents(tx, scene.harnessId, null),
    );
    expect(lapses.filter((event) => event.name === 'delegation_lapsed')).toHaveLength(1);
  });
});

describe('KN-16 a claim refuses a delegation that is not the caller own', () => {
  sceneIt('refuses an unknown delegation', async (scene) => {
    const caller = agentCaller(scene, scene.kim, 'builder', false);
    const outcome = await claimAs(scene, caller, scene.world.adapters.ids.next());
    expect(reasonOf(outcome)).toBe('delegation_not_found');
  });

  sceneIt('refuses a delegation for another harness', async (scene) => {
    const other = await createSimHarness(scene.world, bml);
    const delegationId = await delegate(scene, other.harness.id);
    const outcome = await claimAs(
      scene,
      agentCaller(scene, scene.kim, 'builder', false),
      delegationId,
    );
    expect(reasonOf(outcome)).toBe('not_permitted');
    expect((await itemOf(scene))?.holder).toBeNull();
  });

  sceneIt('refuses another person agent and another persona', async (scene) => {
    const lee = await simPerson(scene.world, 5, [{ role: 'admin', ...area }]);
    const delegationId = await delegate(scene);
    const borrowed = await claimAs(scene, agentCaller(scene, lee, 'builder', false), delegationId);
    const wrong = await claimAs(
      scene,
      agentCaller(scene, scene.kim, 'reviewer', false),
      delegationId,
    );
    expect([reasonOf(borrowed), reasonOf(wrong)]).toEqual(['not_permitted', 'not_permitted']);
  });

  sceneIt('refuses a person who names a delegation', async (scene) => {
    const delegationId = await delegate(scene);
    const outcome = await claimAs(scene, simCaller(scene.world, scene.kim), delegationId);
    expect(reasonOf(outcome)).toBe('not_permitted');
  });
});

describe('KN-5 a lapsed lease is released once', () => {
  sceneIt('lets another agent claim and writes one lease_expired', async (scene) => {
    const builder = agentCaller(scene, scene.max, 'builder', true);
    const reviewer = agentCaller(scene, scene.kim, 'reviewer', true);
    await claimAs(scene, builder);
    scene.world.adapters.clock.advance(16 * minute);
    const taken = value(await claimAs(scene, reviewer));
    expect(taken.item.holder).toBe('agent:reviewer');
    expect(await namesOf(scene)).toEqual([
      'item_created',
      'item_claimed',
      'lease_expired',
      'item_claimed',
    ]);
    const stored = await itemOf(scene);
    expect(stored).toEqual(taken.item);
  });

  sceneIt('expireLapsedLease records the lapse once and ignores a live lease', async (scene) => {
    const builder = agentCaller(scene, scene.max, 'builder', true);
    const claimed = value(await claimAs(scene, builder)).item;
    const context = {
      actor: builder.actor.identity,
      at: scene.world.adapters.clock.now(),
      traceId: builder.traceId,
      ids: scene.world.adapters.ids,
    };
    const run = (at: Date, item: ItemState) =>
      scene.world.adapters.store.transaction((tx) =>
        expireLapsedLease(tx, { ...context, at }, item),
      );
    expect(await run(context.at, claimed)).toEqual(claimed);
    const later = new Date(context.at.getTime() + 16 * minute);
    const released = await run(later, claimed);
    expect(released.holder).toBeNull();
    const fresh = (await itemOf(scene)) as ItemState;
    expect(await run(later, fresh)).toEqual(fresh);
    expect((await namesOf(scene)).filter((name) => name === 'lease_expired')).toHaveLength(1);
  });
});

describe('KN-5 release', () => {
  sceneIt('refuses a non-holder editor and an unheld item', async (scene) => {
    const lee = await simPerson(scene.world, 5, [{ role: 'editor', ...area }]);
    const release = (caller: Caller) =>
      scene.world.kernel.items.release(caller, { itemId: scene.itemId });
    const unheld = await release(simCaller(scene.world, scene.max));
    await claimAs(scene, simCaller(scene.world, scene.max));
    const stranger = await release(simCaller(scene.world, lee));
    expect([reasonOf(unheld), reasonOf(stranger)]).toEqual(['not_holder', 'not_holder']);
  });

  sceneIt('accepts the holder and an org admin, recording item_released', async (scene) => {
    const release = (caller: Caller) =>
      scene.world.kernel.items.release(caller, { itemId: scene.itemId });
    const ian = simCaller(scene.world, await simIan(scene.world));
    await claimAs(scene, simCaller(scene.world, scene.max));
    const byAdmin = value(await release(ian));
    await claimAs(scene, simCaller(scene.world, scene.max));
    const byHolder = value(await release(simCaller(scene.world, scene.max)));
    expect([byAdmin.holder, byHolder.holder]).toEqual([null, null]);
    expect((await namesOf(scene)).filter((name) => name === 'item_released')).toHaveLength(2);
  });
});
