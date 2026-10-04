import type { HarnessEvent, ItemState, Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { bml, readAllEvents, type Caller, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from './fixtures.ts';
import type { World } from './world.ts';

export type IterateScene = {
  readonly world: World;
  readonly harnessId: string;
  readonly admin: Principal;
  readonly editor: Principal;
};

export type IteratePage = {
  readonly id: string;
  readonly type: 'learning' | 'product' | 'product_strategy';
  readonly bodyMd: string;
  readonly jdArea?: string;
};

export function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

export async function iterateScene(world: World): Promise<IterateScene> {
  const { harness, admin } = await createSimHarness(world, bml);
  valueOf(
    await world.kernel.stages.updateStage(simCaller(world, admin), {
      harnessId: harness.id,
      stageKey: 'package',
      change: { feeds: ['close'] },
    }),
  );
  const editor = await simPerson(world, 3, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  return { world, harnessId: harness.id, admin, editor };
}

export async function enqueuedItem(scene: IterateScene, title: string): Promise<string> {
  const outcome = await scene.world.kernel.items.enqueue(simCaller(scene.world, scene.admin), {
    harnessId: scene.harnessId,
    title,
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  return valueOf(outcome).itemId;
}

export async function itemAtClose(scene: IterateScene, title: string): Promise<ItemState> {
  const itemId = await enqueuedItem(scene, title);
  const editor = simCaller(scene.world, scene.editor);
  valueOf(await scene.world.kernel.items.claim(editor, { itemId, delegationId: null }));
  const moved = valueOf(
    await scene.world.kernel.items.submit(editor, {
      itemId,
      to: 'close',
      evidence: {},
      change: null,
    }),
  );
  if (moved.item.stageKey !== 'close') throw new Error(`the item is at ${moved.item.stageKey}`);
  return moved.item;
}

export async function seedIteratePage(world: World, page: IteratePage): Promise<string> {
  await seedPage(world.database.db, {
    id: page.id,
    type: page.type,
    status: 'suggested',
    jdArea: page.jdArea ?? '80-89',
    slug: `${page.type.replaceAll('_', '-')}-${page.id.slice(-4)}`,
    title: `Page ${page.id.slice(-4)}`,
    bodyMd: page.bodyMd,
  });
  return page.id;
}

export function itemEvents(scene: IterateScene, itemId: string): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harnessId, itemId));
}

export function editorCaller(scene: IterateScene): Caller {
  return simCaller(scene.world, scene.editor);
}
