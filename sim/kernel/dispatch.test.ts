import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewritePageFrontmatter, rewritePageStatus, seedPlatformPage } from '@uw/db/test-seed';
import { software } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  platformPageIdOf,
  simAdvance,
  simAgent,
  simCaller,
} from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = { readonly world: World; readonly itemId: string; claim(): Promise<string | null> };

async function atScope(world: World): Promise<Scene> {
  const { harness, admin } = await createSimHarness(world, software, { dispatchable: false });
  const caller = simCaller(world, admin);
  const { itemId } = value(
    await world.kernel.items.enqueue(caller, {
      harnessId: harness.id,
      title: 'Show the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await simAdvance(world, { harnessId: harness.id, itemId, worker: admin, through: ['package'] });
  const agent = simAgent(admin, `${admin.personId ?? ''}/builder`, { interactive: true });
  const claim = async () =>
    reasonOf(
      await world.kernel.items.claim(simCaller(world, agent), { itemId, delegationId: null }),
    );
  return { world, itemId, claim };
}

async function inWorld(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await atScope(world));
  } finally {
    await world.close();
  }
}

const pageId = platformPageIdOf('80-89');

describe('GL-6 ownership gate on dispatch', () => {
  it('refuses an agent claim dispatch_list_unavailable while the area has no platform page', () =>
    inWorld(async (scene) => {
      expect(await scene.claim()).toBe('dispatch_list_unavailable');
    }));

  it('refuses repository_not_dispatchable when the list leaves the repository out', () =>
    inWorld(async (scene) => {
      const db = scene.world.database.db;
      await seedPlatformPage(db, {
        id: pageId,
        jdArea: '80-89',
        repositories: ['unfoldingWord/other'],
      });
      expect(await scene.claim()).toBe('repository_not_dispatchable');
    }));

  it('fails closed on a page short of active and on a list that does not parse', () =>
    inWorld(async (scene) => {
      const db = scene.world.database.db;
      await seedPlatformPage(db, {
        id: pageId,
        jdArea: '80-89',
        repositories: ['unfoldingWord/uw-platform'],
      });
      await rewritePageStatus(db, pageId, 'suggested');
      expect(await scene.claim()).toBe('dispatch_list_unavailable');
      await rewritePageStatus(db, pageId, 'active');
      await rewritePageFrontmatter(db, pageId, { dispatch_allowed: 'unfoldingWord/uw-platform' });
      expect(await scene.claim()).toBe('dispatch_list_unavailable');
    }));

  it('admits the claim once the repository is listed, in any case', () =>
    inWorld(async (scene) => {
      const db = scene.world.database.db;
      await seedPlatformPage(db, {
        id: pageId,
        jdArea: '80-89',
        repositories: ['UNFOLDINGWORD/UW-PLATFORM'],
      });
      expect(await scene.claim()).toBeNull();
    }));
});
