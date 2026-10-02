import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedPage } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
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

  sceneIt('KN-7 an unknown item is item_not_found', async (scene) => {
    const outcome = await scene.world.kernel.items.markNothingLearned(scene.editor, {
      itemId: scene.world.adapters.ids.next(),
      reason: 'Routine dependency bump',
    });
    expect(reasonOf(outcome)).toBe('item_not_found');
  });
});

describe('KN-7 the reason is one line', () => {
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

describe('KN-7 attaching a learning', () => {
  sceneIt('KN-7 an unknown page is page_not_found', async (scene) => {
    const outcome = await scene.world.kernel.items.attachLearning(scene.editor, {
      itemId: scene.itemId,
      pageId: scene.world.adapters.ids.next(),
    });
    expect(reasonOf(outcome)).toBe('page_not_found');
  });

  sceneIt('KN-7 a viewer is not_permitted', async (scene) => {
    const outcome = await scene.world.kernel.items.attachLearning(await viewerOf(scene), {
      itemId: scene.itemId,
      pageId: learningId,
    });
    expect(reasonOf(outcome)).toBe('not_permitted');
  });

  sceneIt('KN-7 a page that is not a suggested learning or skill is refused', async (scene) => {
    const { attachLearning } = scene.world.kernel.items;
    const active = await attachLearning(scene.editor, { itemId: scene.itemId, pageId: activeId });
    const product = await attachLearning(scene.editor, {
      itemId: scene.itemId,
      pageId: productId,
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
    });
    expect(reasonOf(outcome)).toBeNull();
    const events = await scene.world.adapters.store.transaction((tx) =>
      readAllEvents(tx, scene.harnessId, scene.itemId),
    );
    const attached = events.filter((event) => event.name === 'learning_attached');
    expect(attached.map((event) => event.evidence)).toEqual([{ pageId: learningId }]);
  });
});
