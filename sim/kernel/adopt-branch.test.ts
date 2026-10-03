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

function freshAtShifted(scene: Scene, milliseconds: number): PullRequestFacts {
  const freshAt = new Date(scene.world.adapters.clock.now().getTime() + milliseconds);
  return tipFacts(scene, { freshAt });
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

  sceneIt('answers facts_stale for facts more than a minute either side of now', async (scene) => {
    for (const shift of [-61_000, 61_000]) {
      const facts = freshAtShifted(scene, shift);
      const refusal = stale(facts.freshAt.toISOString());
      await refusedWithNothingRecorded(scene, answering(facts), refusal);
    }
  });

  sceneIt('adopts facts read within the minute', async (scene) => {
    const claimed = value(await adoptWith(scene, answering(freshAtShifted(scene, -59_000))));
    expect(claimed.branch.adopted).toBe(true);
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
