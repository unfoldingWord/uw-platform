import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedPage } from '@uw/db/test-seed';
import { LEASE_MS, readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simIan, simPerson } from '../fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const learningId = '00000000-0000-4000-8000-000000008001';
const activeId = '00000000-0000-4000-8000-000000008002';
const productId = '00000000-0000-4000-8000-000000008004';

type Scene = {
  readonly world: World;
  readonly itemId: string;
  readonly harnessId: string;
  readonly owner: Principal;
  readonly editor: Caller;
};

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

async function seedPages(world: World): Promise<void> {
  const base = { jdArea: '80-89', bodyMd: '- [observed] one claim', slug: '', title: 'Page' };
  const { db } = world.database;
  await seedPage(db, { ...base, id: learningId, type: 'learning', status: 'suggested', slug: 'a' });
  await seedPage(db, { ...base, id: activeId, type: 'learning', status: 'active', slug: 'b' });
  await seedPage(db, { ...base, id: productId, type: 'product', status: 'suggested', slug: 'd' });
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    await seedPages(world);
    const owner = await simPerson(world, 6, [{ role: 'editor', ...area }]);
    const editor = simCaller(world, owner);
    const created = await world.kernel.items.enqueue(editor, {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    });
    if (created.status !== 'accepted') throw new Error('enqueue refused');
    await work({ world, itemId: created.value.itemId, harnessId: harness.id, owner, editor });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function viewerOf(scene: Scene): Promise<Caller> {
  return simPerson(scene.world, 8, [{ role: 'viewer', ...area }]).then((viewer) =>
    simCaller(scene.world, viewer),
  );
}

function eventNames(scene: Scene): Promise<readonly string[]> {
  return scene.world.adapters.store
    .transaction((tx) => readAllEvents(tx, scene.harnessId, scene.itemId))
    .then((events) => events.map((event) => event.name));
}

describe('KN-7 an agent cannot sign nothing learned', () => {
  sceneIt('KN-7 an agent principal is not_permitted and nothing is recorded', async (scene) => {
    const agent = simCaller(
      scene.world,
      simAgent(scene.owner, `${scene.owner.personId}/builder`, { interactive: true }),
    );
    const outcome = await scene.world.kernel.items.markNothingLearned(agent, {
      itemId: scene.itemId,
      reason: 'Routine dependency bump',
    });
    expect(reasonOf(outcome)).toBe('not_permitted');
    expect(await eventNames(scene)).not.toContain('nothing_learned');
  });

  sceneIt('KN-7 a viewer is not_permitted', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(await viewerOf(scene), {
      itemId: scene.itemId,
      reason: 'Routine dependency bump',
    });
    expect(reasonOf(outcome)).toBe('not_permitted');
  });

  sceneIt('signing nothing learned on an unknown item is item_not_found', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.world.adapters.ids.next(),
      reason: 'Routine dependency bump',
    });
    expect(reasonOf(outcome)).toBe('item_not_found');
  });
});

describe('KN-7 the reason is one line', () => {
  sceneIt('KN-7 a trailing newline is trimmed and accepted', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.itemId,
      reason: 'Routine bump\n',
    });
    expect(reasonOf(outcome)).toBeNull();
    const events = await scene.world.adapters.store.transaction((tx) =>
      readAllEvents(tx, scene.harnessId, scene.itemId),
    );
    expect(events.find((event) => event.name === 'nothing_learned')?.evidence).toEqual({
      reason: 'Routine bump',
    });
  });

  sceneIt('KN-7 a reason that trims to 200 characters is accepted', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.itemId,
      reason: `${'x'.repeat(200)}   `,
    });
    expect(reasonOf(outcome)).toBeNull();
  });

  sceneIt('KN-7 a blank reason is reason_required', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.itemId,
      reason: '   ',
    });
    expect(reasonOf(outcome)).toBe('reason_required');
  });

  sceneIt('KN-7 a two-line reason is reason_not_one_line', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.itemId,
      reason: 'first line\nsecond line',
    });
    expect(reasonOf(outcome)).toBe('reason_not_one_line');
  });

  sceneIt('KN-7 a reason over 200 characters is reason_not_one_line', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.itemId,
      reason: 'x'.repeat(201),
    });
    expect(reasonOf(outcome)).toBe('reason_not_one_line');
  });
});

describe('KN-7 who, when and why are recorded', () => {
  sceneIt('KN-7 a person signs it: the event carries who, when and why', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.itemId,
      reason: '  Routine dependency bump  ',
    });
    expect(reasonOf(outcome)).toBeNull();
    const events = await scene.world.adapters.store.transaction((tx) =>
      readAllEvents(tx, scene.harnessId, scene.itemId),
    );
    const marker = events.find((event) => event.name === 'nothing_learned');
    expect(marker?.actor).toBe(scene.owner.identity);
    expect(marker?.at).toBe(scene.world.adapters.clock.now().toISOString());
    expect(marker?.evidence).toEqual({ reason: 'Routine dependency bump' });
  });
});

function deviceOf(scene: Scene): Caller {
  const device = `${scene.owner.personId ?? ''}/builder`;
  return simCaller(scene.world, simAgent(scene.owner, device, { interactive: true }));
}

async function claimedByDevice(scene: Scene): Promise<Caller> {
  await scene.world.kernel.stages.updateStage(simCaller(scene.world, await simIan(scene.world)), {
    harnessId: scene.harnessId,
    stageKey: 'package',
    change: { agentPickup: 'allowed' },
  });
  const agent = deviceOf(scene);
  const claimed = await scene.world.kernel.items.claim(agent, {
    itemId: scene.itemId,
    delegationId: null,
  });
  if (claimed.status !== 'accepted') throw new Error(`claim refused: ${claimed.reason}`);
  return agent;
}

function attach(scene: Scene, caller: Caller, pageId = learningId) {
  return scene.world.kernel.items.attachLearning(caller, {
    itemId: scene.itemId,
    pageId,
    delegationId: null,
  });
}

async function attachedBy(scene: Scene): Promise<readonly string[]> {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
  return events.filter((event) => event.name === 'learning_attached').map((event) => event.actor);
}

describe("KN-7 attaching a learning is the holder's act, or a person's with write", () => {
  sceneIt('KN-7 an agent that does not hold the item is not_holder', async (scene) => {
    expect(reasonOf(await attach(scene, deviceOf(scene)))).toBe('not_holder');
    expect(await attachedBy(scene)).toEqual([]);
  });

  sceneIt('KN-7 the agent holding the item attaches and the event names it', async (scene) => {
    const agent = await claimedByDevice(scene);
    expect(reasonOf(await attach(scene, agent))).toBeNull();
    expect(await attachedBy(scene)).toEqual([agent.actor.identity]);
  });

  sceneIt('KN-7 the holder whose lease has lapsed is lease_expired', async (scene) => {
    const agent = await claimedByDevice(scene);
    scene.world.adapters.clock.advance(LEASE_MS + 1);
    expect(reasonOf(await attach(scene, agent))).toBe('lease_expired');
    expect(await attachedBy(scene)).toEqual([]);
    expect(await eventNames(scene)).toContain('lease_expired');
  });

  sceneIt(
    'KN-7 the holder presenting a delegation it did not claim under is not_permitted',
    async (scene) => {
      const agent = await claimedByDevice(scene);
      const outcome = await scene.world.kernel.items.attachLearning(agent, {
        itemId: scene.itemId,
        pageId: learningId,
        delegationId: scene.world.adapters.ids.next(),
      });
      expect(reasonOf(outcome)).toBe('not_permitted');
      expect(await attachedBy(scene)).toEqual([]);
    },
  );

  sceneIt('KN-7 an editor who does not hold the item attaches', async (scene) => {
    await claimedByDevice(scene);
    expect(reasonOf(await attach(scene, scene.editor))).toBeNull();
    expect(await attachedBy(scene)).toEqual([scene.owner.identity]);
  });

  sceneIt('KN-7 a viewer is not_permitted', async (scene) => {
    expect(reasonOf(await attach(scene, await viewerOf(scene)))).toBe('not_permitted');
    expect(await attachedBy(scene)).toEqual([]);
  });

  sceneIt('attaching an unknown page is page_not_found', async (scene) => {
    const outcome = await attach(scene, scene.editor, scene.world.adapters.ids.next());
    expect(reasonOf(outcome)).toBe('page_not_found');
  });
});

describe('KN-7 only suggested learnings attach', () => {
  sceneIt('KN-7 a page that is not a suggested learning or skill is refused', async (scene) => {
    const { attachLearning } = scene.world.kernel.items;
    const active = await attachLearning(scene.editor, {
      itemId: scene.itemId,
      pageId: activeId,
      delegationId: null,
    });
    const product = await attachLearning(scene.editor, {
      itemId: scene.itemId,
      pageId: productId,
      delegationId: null,
    });
    expect([reasonOf(active), reasonOf(product)]).toEqual([
      'malformed_command',
      'malformed_command',
    ]);
    expect(await eventNames(scene)).not.toContain('learning_attached');
  });

  sceneIt('KN-7 a suggested learning is attached and recorded as an event', async (scene) => {
    const outcome = await scene.world.kernel.items.attachLearning(scene.editor, {
      itemId: scene.itemId,
      pageId: learningId,
      delegationId: null,
    });
    expect(reasonOf(outcome)).toBeNull();
    const events = await scene.world.adapters.store.transaction((tx) =>
      readAllEvents(tx, scene.harnessId, scene.itemId),
    );
    const attached = events.filter((event) => event.name === 'learning_attached');
    expect(attached.map((event) => event.evidence)).toEqual([{ pageId: learningId }]);
  });
});
