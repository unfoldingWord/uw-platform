import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller } from '../fixtures.ts';
import {
  editorCaller,
  itemAtClose,
  itemEvents,
  iterateScene,
  seedIteratePage,
  valueOf,
  type IterateScene,
} from '../iterate.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const learning = '00000000-0000-4000-8000-000000009101';
const unlabelled = '00000000-0000-4000-8000-000000009102';
const labelled = '00000000-0000-4000-8000-000000009103';
const elsewhere = '00000000-0000-4000-8000-000000009104';

type Scene = IterateScene & { readonly itemId: string };

async function seedPages(scene: IterateScene): Promise<void> {
  const { world } = scene;
  await seedIteratePage(world, {
    id: learning,
    type: 'learning',
    bodyMd: '- [observed] readers return on Mondays',
  });
  await seedIteratePage(world, {
    id: unlabelled,
    type: 'product_strategy',
    bodyMd: '- [observed] readers return on Mondays\n- readers want shorter guides',
  });
  await seedIteratePage(world, {
    id: labelled,
    type: 'product_strategy',
    bodyMd: '- [observed] readers return on Mondays\n- [inferred] readers want shorter guides',
  });
  await seedIteratePage(world, {
    id: elsewhere,
    type: 'product',
    bodyMd: '- [observed] another area',
    jdArea: '30-39',
  });
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await iterateScene(world);
    await seedPages(scene);
    const { itemId } = await itemAtClose(scene, 'Tune the lantern guide');
    valueOf(await world.kernel.items.claim(editorCaller(scene), { itemId, delegationId: null }));
    await work({ ...scene, itemId });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function submitWith(scene: Scene, attach: readonly string[], caller = editorCaller(scene)) {
  return scene.world.kernel.items.submit(caller, {
    itemId: scene.itemId,
    to: 'scope',
    evidence: {},
    change: null,
    attach,
  });
}

async function attachedNow(scene: Scene): Promise<readonly unknown[]> {
  const events = await itemEvents(scene, scene.itemId);
  return events.filter((event) => event.name === 'learning_attached').map((e) => e.evidence);
}

async function labelsEveryRevision(scene: Scene): Promise<void> {
  const submitted = valueOf(await submitWith(scene, [learning, unlabelled]));
  expect(submitted.result).toBe('checks_failed');
  expect(submitted.failures).toEqual([
    `learning_attached: revision ${unlabelled} has a claim without an evidence label: readers want shorter guides`,
  ]);
  expect(await attachedNow(scene)).toEqual([
    { pageId: learning, kind: 'learning' },
    { pageId: unlabelled, kind: 'revision' },
  ]);
}

async function routesAlongFeeds(scene: Scene): Promise<void> {
  const submitted = valueOf(await submitWith(scene, [learning, labelled]));
  expect([submitted.result, submitted.item.stageKey]).toEqual(['advanced', 'scope']);
  const events = await itemEvents(scene, scene.itemId);
  const last = events.slice(-5);
  expect(last.map((event) => event.name)).toEqual([
    'learning_attached',
    'learning_attached',
    'submitted_to_gate',
    'checks_passed',
    'loop_edge_taken',
  ]);
  expect(new Set(last.map((event) => event.traceId)).size).toBe(1);
  expect(last[1]?.evidence).toEqual({ pageId: labelled, kind: 'revision' });
  expect(last[4]?.evidence).toEqual({ from: 'close', to: 'scope' });
}

async function revisionAlone(scene: Scene): Promise<void> {
  const submitted = valueOf(await submitWith(scene, [labelled]));
  expect(submitted.result).toBe('checks_failed');
  expect(submitted.failures).toEqual([
    'learning_attached: the item carries no suggested learning or skill page and no nothing_learned marker',
  ]);
  const again = valueOf(await submitWith(scene, [labelled, learning]));
  expect(again.result).toBe('advanced');
  expect(await attachedNow(scene)).toHaveLength(2);
}

async function holderAndArea(scene: Scene): Promise<void> {
  const laptop = simAgent(scene.editor, `${scene.editor.personId ?? ''}/laptop`, {
    interactive: true,
  });
  const byAgent = await submitWith(scene, [labelled], simCaller(scene.world, laptop));
  expect(byAgent).toMatchObject({ status: 'error', reason: 'not_holder' });
  const other = await submitWith(scene, [learning, elsewhere]);
  expect(other).toEqual({
    status: 'error',
    reason: 'page_not_found',
    detail: { pageId: elsewhere },
  });
  const missing = scene.world.adapters.ids.next();
  expect(await submitWith(scene, [missing])).toEqual({
    status: 'error',
    reason: 'page_not_found',
    detail: { pageId: missing },
  });
  expect(await attachedNow(scene)).toEqual([]);
  const names = (await itemEvents(scene, scene.itemId)).map((event) => event.name);
  expect(names.at(-1)).toBe('item_claimed');
}

describe('revisions routed to learning_attached', () => {
  sceneIt(
    'KN-7 every revision Iterate proposes carries an evidence label, or learning_attached refuses it',
    labelsEveryRevision,
  );
  sceneIt(
    'PE-7 a revision is attached at submit and routed along the feeds edge in one transaction',
    routesAlongFeeds,
  );
  sceneIt('PE-7 a revision alone does not satisfy learning_attached', revisionAlone);
  sceneIt(
    'PE-7 an agent that does not hold the item cannot attach, and a revision of another area is page_not_found',
    holderAndArea,
  );
});
