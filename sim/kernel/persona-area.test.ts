import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { moveSeededPage, seedPage } from '@uw/db/test-seed';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, readSpend, simCaller, simDelegate, simPerson } from '../fixtures.ts';
import { activatePersona, personaBody } from '../persona-fixtures.ts';
import {
  builderFrontmatter,
  detailOf,
  itemInScope,
  itemOf,
  personaPrincipal,
  reasonOf,
  runWorld,
  startOn,
  systemCaller,
  value,
} from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const financePage = '00000000-0000-4000-8000-000000009561';

async function inWorld(work: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(world);
  } finally {
    await world.close();
  }
}

async function startRefusedOutsideTheArea(world: World): Promise<void> {
  const { harness, admin } = await createSimHarness(world, software);
  await readSpend(world);
  const owner = await simPerson(world, 4, [
    { role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const scene = { world, harnessId: harness.id, owner, admin };
  await seedPage(world.database.db, {
    id: financePage,
    type: 'persona',
    status: 'suggested',
    jdArea: '20-29',
    slug: 'builder-finance',
    title: 'Builder',
    bodyMd: personaBody('builder'),
    frontmatter: builderFrontmatter(scene),
  });
  value(await activatePersona(world, admin, financePage));
  const granted = await simDelegate(world, owner, {
    harnessId: harness.id,
    persona: 'agent:builder',
    capability: 'build',
    expiresAt: null,
    supersedes: null,
  });
  const delegationId = value(granted).id;
  const itemId = await itemInScope(scene, 'Wire the run host');
  const started = await world.kernel.runs.start(simCaller(world, personaPrincipal(owner)), {
    itemId,
    delegationId,
    personaPageId: financePage,
  });
  expect([reasonOf(started), detailOf(started)]).toEqual([
    'page_not_found',
    { pageId: financePage },
  ]);
  expect((await itemOf(world, itemId))?.holder).toBeNull();
}

async function sceneRefusedOnceThePageMoves(world: World): Promise<void> {
  const scene = await runWorld(world);
  const { runId } = value(await startOn(scene));
  const beforeMove = await world.kernel.runs.scene(systemCaller(scene), runId);
  expect(beforeMove.status).toBe('accepted');
  await moveSeededPage(world.database.db, scene.pageId, '20-29');
  const afterMove = await world.kernel.runs.scene(systemCaller(scene), runId);
  expect([reasonOf(afterMove), detailOf(afterMove)]).toEqual([
    'page_not_found',
    { pageId: scene.pageId },
  ]);
}

describe('a hosted run reads persona instructions only from an area its principal may read', () => {
  it('refuses to start a run whose activated persona page is in another area', () =>
    inWorld(startRefusedOutsideTheArea));
  it('refuses the scene once the pinned persona page moves to another area', () =>
    inWorld(sceneRefusedOnceThePageMoves));
});
