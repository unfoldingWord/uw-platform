import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import {
  notWiredCall,
  createKernel,
  FactsUnavailableError,
  software,
  type GitHubFacts,
  type PullRequestFacts,
  type Store,
} from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson, simSeenHead } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  approvedBy,
  greenFacts,
  itemLog,
  namesSince,
  simParkedAtShip,
  standardChange,
} from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
};

const head = standardChange.head;

async function inScene(work: (scene: Scene) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const { harness, admin } = await createSimHarness(world, software);
    const max = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const parked = await simParkedAtShip(world, {
      harnessId: harness.id,
      editor: max,
      title: 'Show the board',
      change: standardChange,
    });
    await work({ world, harnessId: harness.id, itemId: parked.itemId, ian: admin });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function approved(scene: Scene, freshAt?: Date): PullRequestFacts {
  const reviews = [approvedBy('uw-reviewer[bot]', 'anthropic', head, 9100000101)];
  const facts = greenFacts(scene.world, { itemId: scene.itemId, head, reviews });
  return freshAt === undefined ? facts : { ...facts, freshAt };
}

function dismissed(scene: Scene): PullRequestFacts {
  const facts = approved(scene);
  return { ...facts, reviews: facts.reviews.map((entry) => ({ ...entry, state: 'dismissed' })) };
}

type Watched = { readonly store: Store; readonly open: () => boolean };

function watchedStore(store: Store): Watched {
  let depth = 0;
  return {
    open: () => depth > 0,
    store: {
      ...store,
      transaction: async (work) => {
        depth += 1;
        try {
          return await store.transaction(work);
        } finally {
          depth -= 1;
        }
      },
    },
  };
}

async function approveWith(scene: Scene, githubFacts: GitHubFacts, store?: Store) {
  const ports = {
    ...scene.world.adapters,
    githubFacts,
    store: store ?? scene.world.adapters.store,
  };
  const before = await itemLog(scene.world, scene.harnessId, scene.itemId);
  const outcome = await createKernel(ports).gates.decide(simCaller(scene.world, scene.ian), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
  const after = await itemLog(scene.world, scene.harnessId, scene.itemId);
  return { outcome, names: namesSince(before, after), decisions: after.decisions };
}

function factsAnswering(
  pullRequest: GitHubFacts['pullRequest'],
  refresh: GitHubFacts['refresh'],
): GitHubFacts {
  return { pullRequest, refresh, diff: () => notWiredCall('githubFacts', 'diff') };
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>): void {
  it(title, () => inScene(work));
}

describe('GH-5 an approve at Ship decides on facts refreshed from GitHub before its transaction', () => {
  sceneIt(
    'refuses a review GitHub dismissed that the read model still shows approved',
    async (scene) => {
      const githubFacts = factsAnswering(
        async () => approved(scene),
        async () => dismissed(scene),
      );
      const { outcome, names, decisions } = await approveWith(scene, githubFacts);
      expect(outcome).toMatchObject({ status: 'error', reason: 'no_reviewer_approval' });
      expect(names).toEqual(['risk_derived', 'ship_refused']);
      expect(decisions).toEqual([]);
      expect(scene.world.adapters.connectors.calls()).toEqual([]);
    },
  );

  sceneIt('refreshes while no transaction is open', async (scene) => {
    const watched = watchedStore(scene.world.adapters.store);
    const seen: boolean[] = [];
    const githubFacts = factsAnswering(
      async () => approved(scene),
      async () => {
        seen.push(watched.open());
        return approved(scene);
      },
    );
    const { outcome } = await approveWith(scene, githubFacts, watched.store);
    expect(outcome.status).toBe('accepted');
    expect(seen).toEqual([false]);
  });
});

describe('GH-5 an approve at Ship fails closed on stale or missing GitHub facts', () => {
  sceneIt('refuses facts older than a minute without deciding or recording', async (scene) => {
    const at = scene.world.adapters.clock.now();
    const stale = approved(scene, new Date(at.getTime() - 60_001));
    const githubFacts = factsAnswering(
      async () => approved(scene),
      async () => stale,
    );
    const { outcome, names, decisions } = await approveWith(scene, githubFacts);
    expect(outcome).toMatchObject({ status: 'error', reason: 'facts_stale' });
    expect(names).toEqual([]);
    expect(decisions).toEqual([]);
    expect(scene.world.adapters.connectors.calls()).toEqual([]);
  });

  sceneIt('refuses facts stamped more than a minute after the decision', async (scene) => {
    const at = scene.world.adapters.clock.now();
    const ahead = approved(scene, new Date(at.getTime() + 60_001));
    const githubFacts = factsAnswering(
      async () => approved(scene),
      async () => ahead,
    );
    const { outcome, names, decisions } = await approveWith(scene, githubFacts);
    expect(outcome).toMatchObject({ status: 'error', reason: 'facts_stale' });
    expect(names).toEqual([]);
    expect(decisions).toEqual([]);
  });

  sceneIt('accepts facts refreshed within the minute', async (scene) => {
    const at = scene.world.adapters.clock.now();
    const recent = approved(scene, new Date(at.getTime() - 60_000));
    const githubFacts = factsAnswering(
      async () => null,
      async () => recent,
    );
    const { outcome, decisions } = await approveWith(scene, githubFacts);
    expect(outcome.status).toBe('accepted');
    expect(decisions).toEqual(['approve']);
  });

  sceneIt('refuses when GitHub has no facts for the pull request', async (scene) => {
    const githubFacts = factsAnswering(
      async () => approved(scene),
      async () => null,
    );
    const { outcome, names, decisions } = await approveWith(scene, githubFacts);
    expect(outcome).toMatchObject({ status: 'error', reason: 'pr_not_open' });
    expect(names).toEqual(['ship_refused']);
    expect(decisions).toEqual([]);
  });
});

describe('GH-5 an approve at Ship fails closed when GitHub cannot be read again', () => {
  sceneIt('refuses as stale when GitHub cannot be read again', async (scene) => {
    const githubFacts = factsAnswering(
      async () => approved(scene),
      async () => {
        throw new FactsUnavailableError('server_error');
      },
    );
    const { outcome, names, decisions } = await approveWith(scene, githubFacts);
    expect(outcome).toMatchObject({
      status: 'error',
      reason: 'facts_stale',
      detail: { freshAt: null },
    });
    expect(names).toEqual([]);
    expect(decisions).toEqual([]);
  });
});
