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

type Scene = {
  readonly world: World;
  readonly itemId: string;
  claim(): Promise<string | null>;
  personClaim(): Promise<string | null>;
};

async function atScope(world: World, repository?: null): Promise<Scene> {
  const { harness, admin } = await createSimHarness(world, software, {
    dispatchable: false,
    ...(repository === undefined ? {} : { repository }),
  });
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
  const personClaim = async () =>
    reasonOf(
      await world.kernel.items.claim(simCaller(world, admin), { itemId, delegationId: null }),
    );
  return { world, itemId, claim, personClaim };
}

async function inWorld(work: (scene: Scene) => Promise<void>, repository?: null): Promise<void> {
  const world = await createWorld();
  try {
    await work(await atScope(world, repository));
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

describe('GL-6 the dispatch gate leaves person claims and repository-less harnesses alone', () => {
  it('does not gate a person claim on a repository the list leaves out', () =>
    inWorld(async (scene) => {
      await seedPlatformPage(scene.world.database.db, {
        id: pageId,
        jdArea: '80-89',
        repositories: ['unfoldingWord/other'],
      });
      expect(await scene.personClaim()).toBeNull();
    }));

  it('does not gate an agent claim on a harness that names no repository', () =>
    inWorld(async (scene) => {
      expect(await scene.claim()).toBeNull();
    }, null));
});
