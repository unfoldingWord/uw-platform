import type { HarnessEvent, PullRequestDeclaration } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import {
  createKernel,
  PortNotWiredError,
  readAllEvents,
  software,
  type Caller,
  type GitHubFacts,
  type Kernel,
  type KernelOutcome,
  type PullRequestFacts,
  type PullRequestRef,
  type SubmitChange,
} from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { greenFacts, shipPullRequest, simSha } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;
const head = simSha('abc123');
const otherHead = simSha('def456');
const migrationPaths = ['packages/db/migrations/0001.sql', 'infra/old.toml'];

const standard: PullRequestDeclaration = {
  closes: [],
  risks: 'none known',
  touches: 'the schema',
  riskTier: 'standard',
  riskDomains: [],
};

type Scene = {
  readonly world: World;
  readonly harnessId: string;
  readonly builder: Caller;
  readonly viewer: Caller;
};

async function inScene(work: (scene: Scene) => Promise<void>, repository?: null): Promise<void> {
  const world = await createWorld();
  try {
    const options = repository === null ? { repository } : {};
    const { harness } = await createSimHarness(world, software, options);
    const max = await simPerson(world, 6, [{ role: 'editor', ...area }]);
    const viewer = await simPerson(world, 8, [{ role: 'viewer', ...area }]);
    await work({
      world,
      harnessId: harness.id,
      builder: simCaller(world, simAgent(max, `${max.personId}/builder`, { interactive: true })),
      viewer: simCaller(world, viewer),
    });
  } finally {
    await world.close();
  }
}

function sceneIt(title: string, work: (scene: Scene) => Promise<void>, repository?: null): void {
  it(title, () => inScene(work, repository));
}

function value<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function heldAtScope(scene: Scene): Promise<string> {
  const { world, harnessId } = scene;
  const { itemId } = value(
    await world.kernel.items.enqueue(scene.builder, {
      harnessId,
      title: 'Move the schema',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await world.adapters.store.transaction(async (tx) => {
    const item = await tx.harnessItems.read.lock(itemId);
    if (item === null) throw new Error('item vanished');
    await tx.harnessItems.write.project({ ...item, stageKey: 'scope' });
    const stages = await tx.harnessStages.read.forHarness(harnessId);
    const scope = stages.find((stage) => stage.key === 'scope');
    if (scope === undefined) throw new Error('no scope stage');
    await tx.harnessStages.write.update({ ...scope, validators: ['learning_attached'] });
  });
  value(await world.kernel.items.claim(scene.builder, { itemId, delegationId: null }));
  return itemId;
}

function changeAt(sha: string, pullRequest: PullRequestRef = shipPullRequest): SubmitChange {
  return { pullRequest, head: sha };
}

function submitAs(scene: Scene, caller: Caller, itemId: string, change: SubmitChange | null) {
  return submitOn(scene.world.kernel, caller, itemId, change);
}

function submitOn(kernel: Kernel, caller: Caller, itemId: string, change: SubmitChange | null) {
  return kernel.items.submit(caller, { itemId, to: null, evidence: {}, change });
}

function eventsOf(scene: Scene, itemId: string): Promise<readonly HarnessEvent[]> {
  return scene.world.adapters.store.transaction((tx) => readAllEvents(tx, scene.harnessId, itemId));
}

async function named(scene: Scene, itemId: string, name: string): Promise<HarnessEvent[]> {
  return (await eventsOf(scene, itemId)).filter((event) => event.name === name);
}

function factsFor(scene: Scene, itemId: string, at: string = head): PullRequestFacts {
  return greenFacts(scene.world, {
    itemId,
    head: at,
    reviews: [],
    paths: migrationPaths,
    declaration: standard,
  });
}

async function expectNoRiskButSubmitted(scene: Scene, itemId: string): Promise<void> {
  value(await submitAs(scene, scene.builder, itemId, changeAt(head)));
  expect(await named(scene, itemId, 'risk_derived')).toEqual([]);
  const [submitted] = await named(scene, itemId, 'submitted_to_gate');
  expect(submitted?.evidence).toMatchObject({ expectedHead: head, pullRequest: shipPullRequest });
}

function recordingFacts(scene: Scene): { port: GitHubFacts; calls: PullRequestRef[] } {
  const calls: PullRequestRef[] = [];
  const facts = scene.world.adapters.githubFacts;
  const port: GitHubFacts = {
    pullRequest: (ref) => {
      calls.push(ref);
      return facts.pullRequest(ref);
    },
    refresh: (ref) => {
      calls.push(ref);
      return facts.refresh(ref);
    },
  };
  return { port, calls };
}

describe('KN-17 submit derives risk from the changed files and declaration GitHub holds at the head', () => {
  sceneIt('derives the tier from the changed files and declaration GitHub holds', async (scene) => {
    const itemId = await heldAtScope(scene);
    scene.world.adapters.githubFacts.given(factsFor(scene, itemId));
    value(await submitAs(scene, scene.builder, itemId, changeAt(head)));
    const [derived] = await named(scene, itemId, 'risk_derived');
    expect(derived?.evidence).toEqual({
      paths: migrationPaths,
      declaration: { riskTier: 'standard', riskDomains: [] },
      floorDomains: ['infra', 'migration'],
      riskTier: 'high',
      riskDomains: ['infra', 'migration'],
      refusal: null,
      head,
    });
  });

  sceneIt('derives nothing when the facts are at another head', async (scene) => {
    const itemId = await heldAtScope(scene);
    scene.world.adapters.githubFacts.given(factsFor(scene, itemId, otherHead));
    await expectNoRiskButSubmitted(scene, itemId);
  });

  sceneIt('derives nothing when the facts hold no changed files', async (scene) => {
    const itemId = await heldAtScope(scene);
    scene.world.adapters.githubFacts.given({ ...factsFor(scene, itemId), files: null });
    await expectNoRiskButSubmitted(scene, itemId);
  });

  sceneIt('derives nothing when the changed files are of an older head', async (scene) => {
    const itemId = await heldAtScope(scene);
    const facts = factsFor(scene, itemId);
    const files = { head: otherHead, base: facts.base, paths: migrationPaths };
    scene.world.adapters.githubFacts.given({ ...facts, files });
    await expectNoRiskButSubmitted(scene, itemId);
  });

  sceneIt('derives nothing when the pull request is on another branch', async (scene) => {
    const itemId = await heldAtScope(scene);
    scene.world.adapters.githubFacts.given({ ...factsFor(scene, itemId), headRef: 'feature/x' });
    await expectNoRiskButSubmitted(scene, itemId);
  });

  sceneIt('derives nothing when GitHub holds no facts for the pull request', async (scene) => {
    await expectNoRiskButSubmitted(scene, await heldAtScope(scene));
  });
});

describe('submit takes no paths or declaration from the change', () => {
  sceneIt('ignores paths and a declaration the agent puts in the change', async (scene) => {
    const itemId = await heldAtScope(scene);
    const smuggled = {
      ...changeAt(head),
      paths: ['apps/uw-app/board.tsx'],
      declaration: { riskTier: 'low', riskDomains: [] },
    };
    value(await submitAs(scene, scene.builder, itemId, smuggled));
    expect(await named(scene, itemId, 'risk_derived')).toEqual([]);
    expect((await eventsOf(scene, itemId)).at(-2)?.name).toBe('submitted_to_gate');
  });
});

describe('GH-5 submit takes only a full commit SHA as the head', () => {
  sceneIt('refuses an abbreviated head as malformed and records nothing', async (scene) => {
    const itemId = await heldAtScope(scene);
    const before = await eventsOf(scene, itemId);
    const outcome = await submitAs(scene, scene.builder, itemId, changeAt('abc123'));
    expect(outcome).toEqual({
      status: 'error',
      reason: 'malformed_command',
      detail: { head: 'abc123' },
    });
    expect(await eventsOf(scene, itemId)).toEqual(before);
  });

  sceneIt('refuses a full head with surrounding space as malformed', async (scene) => {
    const itemId = await heldAtScope(scene);
    const before = await eventsOf(scene, itemId);
    const outcome = await submitAs(scene, scene.builder, itemId, changeAt(` ${head} `));
    expect(outcome).toMatchObject({ status: 'error', reason: 'malformed_command' });
    expect(await eventsOf(scene, itemId)).toEqual(before);
  });

  sceneIt('stores an uppercase full head lowercased', async (scene) => {
    const itemId = await heldAtScope(scene);
    const submitted = value(
      await submitAs(scene, scene.builder, itemId, changeAt(head.toUpperCase())),
    );
    expect(submitted.item.expectedHead).toBe(head);
  });
});

describe('submit refuses a pull request in another repository', () => {
  const elsewhere = { repo: 'unfoldingWord/other', number: 42 };

  sceneIt('refuses the holder with repository_mismatch and records nothing', async (scene) => {
    const itemId = await heldAtScope(scene);
    const before = await eventsOf(scene, itemId);
    const outcome = await submitAs(scene, scene.builder, itemId, changeAt(head, elsewhere));
    expect(outcome).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { why: 'repository_mismatch' },
    });
    expect(await eventsOf(scene, itemId)).toEqual(before);
  });

  sceneIt('reads no GitHub facts for a pull request in another repository', async (scene) => {
    const itemId = await heldAtScope(scene);
    const { port, calls } = recordingFacts(scene);
    const kernel = createKernel({ ...scene.world.adapters, githubFacts: port });
    await submitOn(kernel, scene.builder, itemId, changeAt(head, elsewhere));
    expect(calls).toEqual([]);
    await submitOn(kernel, scene.builder, itemId, changeAt(head));
    expect(calls).toEqual([shipPullRequest]);
  });

  sceneIt(
    'refuses on a harness with no repository',
    async (scene) => {
      const itemId = await heldAtScope(scene);
      const outcome = await submitAs(scene, scene.builder, itemId, changeAt(head));
      expect(outcome).toEqual({
        status: 'error',
        reason: 'not_permitted',
        detail: { why: 'repository_mismatch' },
      });
    },
    null,
  );

  sceneIt('answers a caller without standing as before, naming no repository', async (scene) => {
    const itemId = await heldAtScope(scene);
    const outcome = await submitAs(scene, scene.viewer, itemId, changeAt(head, elsewhere));
    expect(outcome).toEqual({
      status: 'error',
      reason: 'not_permitted',
      detail: { harnessId: scene.harnessId },
    });
  });
});

describe('GH-4 a later submit replaces the expected head', () => {
  sceneIt('records each head and derives at each', async (scene) => {
    const itemId = await heldAtScope(scene);
    scene.world.adapters.githubFacts.given(factsFor(scene, itemId));
    value(await submitAs(scene, scene.builder, itemId, changeAt(head)));
    scene.world.adapters.githubFacts.given(factsFor(scene, itemId, otherHead));
    const second = value(await submitAs(scene, scene.builder, itemId, changeAt(otherHead)));
    expect(second.item.expectedHead).toBe(otherHead);
    const heads = (await named(scene, itemId, 'risk_derived')).map((e) => e.evidence['head']);
    expect(heads).toEqual([head, otherHead]);
  });
});

describe('a submit whose GitHub facts are not wired is refused', () => {
  sceneIt('answers not_wired and records nothing', async (scene) => {
    const itemId = await heldAtScope(scene);
    const unwired = {
      pullRequest: () => Promise.reject(new PortNotWiredError('githubFacts', 'pullRequest')),
      refresh: () => Promise.reject(new PortNotWiredError('githubFacts', 'refresh')),
    };
    const kernel = createKernel({ ...scene.world.adapters, githubFacts: unwired });
    const before = await eventsOf(scene, itemId);
    const outcome = await submitOn(kernel, scene.builder, itemId, changeAt(head));
    expect(outcome).toEqual({
      status: 'error',
      reason: 'not_wired',
      detail: { port: 'githubFacts' },
    });
    expect(await eventsOf(scene, itemId)).toEqual(before);
  });
});

describe('KN-17 submit derives no risk from changed files read against another base', () => {
  sceneIt(
    'derives nothing when the changed files were compared against another base',
    async (scene) => {
      const itemId = await heldAtScope(scene);
      const facts = factsFor(scene, itemId);
      const files = { head, base: otherHead, paths: migrationPaths };
      scene.world.adapters.githubFacts.given({ ...facts, files });
      await expectNoRiskButSubmitted(scene, itemId);
    },
  );
});
