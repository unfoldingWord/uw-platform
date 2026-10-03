import type { HarnessEvent, Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import {
  createKernel,
  readAllEvents,
  software,
  type Caller,
  type GitHubFacts,
  type KernelOutcome,
  type PullRequestFacts,
} from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createSimHarness,
  simAdvance,
  simAgent,
  simCaller,
  simIan,
  simPerson,
} from '../fixtures.ts';
import { greenFacts, shipPullRequest, simSha } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const minute = 60_000;
const tip = simSha('c3');
const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly owner: Principal;
};

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

function device(scene: Scene, owner: Principal, name: string): Caller {
  return simCaller(
    scene.world,
    simAgent(owner, `${owner.personId}/${name}`, { interactive: true }),
  );
}

async function abandon(world: World, harnessId: string, owner: Principal): Promise<string> {
  const editor = simCaller(world, owner);
  const input = { harnessId, title: 'Wire the board', pageId: null, priority: 1, due: null };
  const { itemId } = value(
    await world.kernel.items.enqueue(editor, { ...input, delegationId: null }),
  );
  await simAdvance(world, { harnessId, itemId, worker: owner, through: ['package'] });
  const builder = simCaller(
    world,
    simAgent(owner, `${owner.personId}/first`, { interactive: true }),
  );
  value(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  const change = { pullRequest: shipPullRequest, head: simSha('a1') };
  value(await world.kernel.items.submit(builder, { itemId, to: null, evidence: {}, change }));
  world.adapters.clock.advance(16 * minute);
  return itemId;
}

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness } = await createSimHarness(world, software);
    value(
      await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
        harnessId: harness.id,
        stageKey: 'scope',
        change: { validators: ['learning_attached'] },
      }),
    );
    const owner = await simPerson(world, 2, [{ role: 'editor', ...area }]);
    const itemId = await abandon(world, harness.id, owner);
    await work({ world, harnessId: harness.id, itemId, owner });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

function eventsOf(scene: Scene): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
}

function answering(facts: PullRequestFacts | null): GitHubFacts {
  return { pullRequest: async () => facts, refresh: async () => facts };
}

async function adoptWith(scene: Scene, port: GitHubFacts, caller?: Caller) {
  const kernel = createKernel({ ...scene.world.adapters, githubFacts: port });
  const who = caller ?? device(scene, scene.owner, 'second');
  return kernel.items.claim(who, { itemId: scene.itemId, delegationId: null, adoptBranch: true });
}

function tipFacts(scene: Scene, change: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    ...greenFacts(scene.world, { itemId: scene.itemId, head: tip, reviews: [] }),
    ...change,
  };
}

const notAdoptable = {
  status: 'error',
  reason: 'not_permitted',
  detail: { adoptBranch: true, why: 'branch_not_adoptable' },
};

async function refusedWithNothingRecorded(
  scene: Scene,
  port: GitHubFacts,
  refusal: unknown = notAdoptable,
): Promise<void> {
  const before = await eventsOf(scene);
  expect(await adoptWith(scene, port)).toEqual(refusal);
  expect(await eventsOf(scene)).toEqual(before);
}

function freshAt(at: Date, milliseconds: number): PullRequestFacts['freshAt'] {
  return new Date(at.getTime() + milliseconds);
}

async function leaseEnd(scene: Scene): Promise<Date> {
  const item = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessItems.read.byId(scene.itemId),
  );
  if (item?.leaseExpiresAt == null) throw new Error('the item holds no lease');
  return new Date(item.leaseExpiresAt);
}

async function releasedAfterLapse(scene: Scene): Promise<Date> {
  scene.world.adapters.clock.advance(60 * minute);
  const first = device(scene, scene.owner, 'first');
  const input = { itemId: scene.itemId, delegationId: null };
  const released = value(await scene.world.kernel.items.release(first, input));
  expect(released.branchState).toBe('abandoned');
  const abandoned = (await eventsOf(scene)).findLast((event) => event.name === 'branch_abandoned');
  if (abandoned === undefined) throw new Error('no branch_abandoned was recorded');
  return new Date(abandoned.at);
}

function stale(freshAt: string | null) {
  return { status: 'error', reason: 'facts_stale', detail: { freshAt } };
}

describe('GH-4 adopting takes no tip whose head lives outside the harness repository', () => {
  sceneIt(
    'refuses a tip whose head is in a fork or a deleted fork and records nothing',
    async (scene) => {
      for (const headRepo of ['someone/uw-platform', null]) {
        await refusedWithNothingRecorded(scene, answering(tipFacts(scene, { headRepo })));
      }
    },
  );
});

describe('GH-4 adopting takes only the tip of the item’s own branch on a pull request in its harness repository', () => {
  sceneIt('refuses a tip on another item’s branch and records nothing', async (scene) => {
    const other = tipFacts(scene, { headRef: `harness/${crypto.randomUUID()}` });
    await refusedWithNothingRecorded(scene, answering(other));
  });

  sceneIt('refuses a pull request in another repository and records nothing', async (scene) => {
    const foreign = tipFacts(scene, { ref: { repo: 'someone/uw-platform', number: 42 } });
    await refusedWithNothingRecorded(scene, answering(foreign));
  });

  sceneIt('answers facts_stale when GitHub holds no facts for the pull request', async (scene) => {
    await refusedWithNothingRecorded(scene, answering(null), stale(null));
  });

  sceneIt('refuses the branch of a closed or merged pull request', async (scene) => {
    for (const state of ['closed', 'merged'] as const) {
      await refusedWithNothingRecorded(scene, answering(tipFacts(scene, { state })));
    }
  });

  sceneIt('refuses a tip that is not a full SHA', async (scene) => {
    await refusedWithNothingRecorded(scene, answering(tipFacts(scene, { head: 'c3' })));
  });

  sceneIt('answers a caller with no write grant before any facts failure', async (scene) => {
    const failing: GitHubFacts = {
      pullRequest: () => Promise.reject(new Error('down')),
      refresh: () => Promise.reject(new Error('down')),
    };
    const stranger = await simPerson(scene.world, 3, []);
    const outsider = await adoptWith(scene, failing, device(scene, stranger, 'outsider'));
    expect(outsider).toMatchObject({ status: 'error', reason: 'not_permitted' });
    expect(await adoptWith(scene, failing)).toMatchObject({
      status: 'error',
      reason: 'internal_error',
      detail: { port: 'githubFacts' },
    });
  });
});

describe('GH-4 adopting takes only facts GitHub reported after the branch was abandoned', () => {
  sceneIt(
    'answers facts_stale for facts read no later than the lapse the claim records',
    async (scene) => {
      const lapsed = await leaseEnd(scene);
      for (const shift of [-1_000, 0]) {
        const facts = tipFacts(scene, { freshAt: freshAt(lapsed, shift) });
        await refusedWithNothingRecorded(
          scene,
          answering(facts),
          stale(facts.freshAt.toISOString()),
        );
      }
    },
  );

  sceneIt('adopts facts read after the lapse, however long before the claim', async (scene) => {
    const lapsed = await leaseEnd(scene);
    scene.world.adapters.clock.advance(60 * minute);
    const facts = tipFacts(scene, { freshAt: freshAt(lapsed, 1_000) });
    const claimed = value(await adoptWith(scene, answering(facts)));
    expect(claimed.branch).toMatchObject({ startFrom: tip, adopted: true });
  });

  sceneIt(
    'measures from a recorded abandonment, not from the lease it lapsed from',
    async (scene) => {
      const lapsed = await leaseEnd(scene);
      const abandoned = await releasedAfterLapse(scene);
      const between = tipFacts(scene, { freshAt: freshAt(lapsed, 1_000) });
      const refusal = stale(between.freshAt.toISOString());
      await refusedWithNothingRecorded(scene, answering(between), refusal);
      const after = tipFacts(scene, { freshAt: freshAt(abandoned, 1_000) });
      expect(value(await adoptWith(scene, answering(after))).branch.adopted).toBe(true);
    },
  );
});

describe('GH-4 adopting measures from the last lapse, not only the first abandonment', () => {
  sceneIt(
    'refuses facts stamped before a declining holder’s own lease lapsed, then adopts after it',
    async (scene) => {
      const second = device(scene, scene.owner, 'second');
      const declined = value(
        await scene.world.kernel.items.claim(second, { itemId: scene.itemId, delegationId: null }),
      );
      expect(declined.branch.adopted).toBe(false);
      const pushedAt = freshAt(scene.world.adapters.clock.now(), 5 * minute);
      const lapsed = await leaseEnd(scene);
      scene.world.adapters.clock.advance(16 * minute);
      const beforeLapse = tipFacts(scene, { freshAt: pushedAt });
      await refusedWithNothingRecorded(
        scene,
        answering(beforeLapse),
        stale(pushedAt.toISOString()),
      );
      const afterLapse = tipFacts(scene, { freshAt: freshAt(lapsed, 1_000) });
      expect(value(await adoptWith(scene, answering(afterLapse))).branch.adopted).toBe(true);
    },
  );

  sceneIt('counts a lapse recorded by an earlier command', async (scene) => {
    const second = device(scene, scene.owner, 'second');
    value(
      await scene.world.kernel.items.claim(second, { itemId: scene.itemId, delegationId: null }),
    );
    const pushedAt = freshAt(scene.world.adapters.clock.now(), 5 * minute);
    const lapsed = await leaseEnd(scene);
    scene.world.adapters.clock.advance(16 * minute);
    const input = { itemId: scene.itemId, delegationId: null };
    expect((await scene.world.kernel.items.release(second, input)).status).toBe('accepted');
    await refusedWithNothingRecorded(
      scene,
      answering(tipFacts(scene, { freshAt: pushedAt })),
      stale(pushedAt.toISOString()),
    );
    const afterLapse = tipFacts(scene, { freshAt: freshAt(lapsed, 1_000) });
    expect(value(await adoptWith(scene, answering(afterLapse))).branch.adopted).toBe(true);
  });
});

describe('adoption reads GitHub facts outside the claim transaction', () => {
  sceneIt('reads GitHub facts before the claim transaction opens', async (scene) => {
    const port: GitHubFacts = {
      pullRequest: async () => {
        await scene.world.adapters.store.transaction((tx) =>
          tx.harnessItems.read.byId(crypto.randomUUID()),
        );
        return tipFacts(scene);
      },
      refresh: async () => null,
    };
    const claimed = value(await adoptWith(scene, port));
    expect(claimed.branch).toEqual({
      name: `harness/${scene.itemId}`,
      startFrom: tip,
      adopted: true,
    });
  });
});
