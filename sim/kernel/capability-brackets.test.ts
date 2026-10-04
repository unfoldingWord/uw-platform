import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedActivePersona } from '@uw/db/test-seed';
import type { CapabilityWord, Principal } from '@uw/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { readSpend, simAgent, simCaller, simDelegate } from '../fixtures.ts';
import {
  editorCaller,
  enqueuedItem,
  itemAtClose,
  iterateScene,
  valueOf,
  type IterateScene,
} from '../iterate.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = IterateScene & { readonly atScope: string; readonly atClose: string };

async function itemAtScope(scene: IterateScene): Promise<string> {
  const itemId = await enqueuedItem(scene, 'Shorten the guide');
  const editor = editorCaller(scene);
  valueOf(await scene.world.kernel.items.claim(editor, { itemId, delegationId: null }));
  const moved = valueOf(
    await scene.world.kernel.items.submit(editor, { itemId, to: null, evidence: {}, change: null }),
  );
  if (moved.item.stageKey !== 'scope') throw new Error(`the item is at ${moved.item.stageKey}`);
  return itemId;
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await iterateScene(world);
    await readSpend(world);
    const atScope = await itemAtScope(scene);
    const { itemId: atClose } = await itemAtClose(scene, 'Tune the lantern guide');
    await work({ ...scene, atScope, atClose });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

async function delegated(scene: Scene, slug: string, capability: CapabilityWord) {
  const granted = await simDelegate(scene.world, scene.admin, {
    harnessId: scene.harnessId,
    persona: `agent:${slug}`,
    capability,
    expiresAt: null,
    supersedes: null,
  });
  const delegationId = valueOf(granted).id;
  const persona: Principal = simAgent(scene.admin, slug, { interactive: false });
  return { delegationId, caller: simCaller(scene.world, persona) };
}

async function polled(scene: Scene, caller: ReturnType<typeof simCaller>) {
  const items = valueOf(
    await scene.world.kernel.reads.poll(caller, { harnessId: scene.harnessId, limit: 10 }),
  );
  return items.map((item) => item.itemId);
}

async function outsideBracket(scene: Scene): Promise<void> {
  const { claim } = scene.world.kernel.items;
  const iterate = await delegated(scene, 'iterate', 'iterate');
  expect(await polled(scene, iterate.caller)).toEqual([scene.atClose]);
  const outside = await claim(iterate.caller, {
    itemId: scene.atScope,
    delegationId: iterate.delegationId,
  });
  expect(outside).toEqual({
    status: 'error',
    reason: 'pickup_not_allowed',
    detail: { stage: 'scope', capability: 'iterate' },
  });
  const builder = await delegated(scene, 'builder', 'build');
  expect(await polled(scene, builder.caller)).toEqual([scene.atScope]);
  const closing = await claim(builder.caller, {
    itemId: scene.atClose,
    delegationId: builder.delegationId,
  });
  expect(closing).toMatchObject({ reason: 'pickup_not_allowed', detail: { stage: 'close' } });
  const inside = await claim(iterate.caller, {
    itemId: scene.atClose,
    delegationId: iterate.delegationId,
  });
  expect(inside.status).toBe('accepted');
}

async function pageDisagrees(scene: Scene): Promise<void> {
  await seedActivePersona(scene.world.database.db, {
    identity: 'agent:mixed',
    harnessId: scene.harnessId,
    frontmatter: { capability: 'build' },
  });
  const mixed = await delegated(scene, 'mixed', 'iterate');
  expect(await polled(scene, mixed.caller)).toEqual([]);
  const refused = await scene.world.kernel.items.claim(mixed.caller, {
    itemId: scene.atClose,
    delegationId: mixed.delegationId,
  });
  expect(refused).toEqual({
    status: 'error',
    reason: 'pickup_not_allowed',
    detail: { stage: 'close', capability: 'iterate' },
  });
}

async function personUnaffected(scene: Scene): Promise<void> {
  const { claim } = scene.world.kernel.items;
  const editor = editorCaller(scene);
  expect((await claim(editor, { itemId: scene.atClose, delegationId: null })).status).toBe(
    'accepted',
  );
  const laptop = simAgent(scene.editor, `${scene.editor.personId ?? ''}/laptop`, {
    interactive: true,
  });
  const device = await claim(simCaller(scene.world, laptop), {
    itemId: scene.atScope,
    delegationId: null,
  });
  expect(device.status).toBe('accepted');
}

describe('capability brackets for delegated work', () => {
  sceneIt(
    "a delegated claim outside its capability's bracket is refused pickup_not_allowed, and poll does not offer it",
    outsideBracket,
  );
  sceneIt(
    "a delegation whose capability differs from its persona page's is refused and not offered",
    pageDisagrees,
  );
  sceneIt("a person's claim is not narrowed by any capability", personUnaffected);
});
