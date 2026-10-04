import type { ItemState, Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { software, type Caller } from '@uw/harness';
import {
  createSimHarness,
  simAgent,
  simCaller,
  simDelegate,
  simParkedAtCheck,
  simPerson,
} from './fixtures.ts';
import { shipPullRequest, simParkedAtShip, simSha, standardChange } from './ship-fixtures.ts';
import {
  beatOf,
  itemInScope,
  runWorld,
  startOn,
  stepOn,
  systemCaller,
  value,
  type RunWorld,
} from './runs.ts';
import type { World } from './world.ts';

export const minute = 60_000;

export type FlowWorld = RunWorld & {
  readonly editor: Principal;
  readonly laptop: Caller;
  readonly metered: string;
  readonly subscribed: string;
  readonly personHeld: string;
  readonly unheld: string;
};

async function enqueued(scene: RunWorld, title: string, priority = 1): Promise<string> {
  const outcome = await scene.world.kernel.items.enqueue(simCaller(scene.world, scene.admin), {
    harnessId: scene.harnessId,
    title,
    pageId: null,
    priority,
    due: null,
    delegationId: null,
  });
  return value(outcome).itemId;
}

export async function enqueuedMany(scene: RunWorld, count: number): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= count; n += 1) ids.push(await enqueued(scene, `Backlog item ${n}`, n % 3));
  return ids;
}

async function meteredRun(scene: RunWorld): Promise<void> {
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await stepOn(scene, beat, { runId, step: 'work' }));
}

async function subscribedRun(scene: RunWorld, laptop: Caller, itemId: string): Promise<void> {
  const { items } = scene.world.kernel;
  value(await items.claim(laptop, { itemId, delegationId: null }));
  value(
    await items.recordRunStep(laptop, {
      itemId,
      runId: scene.world.adapters.ids.next(),
      step: 'work',
      tokensIn: 900,
      tokensOut: 300,
      costBasis: 'subscription',
    }),
  );
}

export async function flowWorld(world: World): Promise<FlowWorld> {
  const scene = await runWorld(world);
  world.adapters.clock.advance(2 * minute);
  await meteredRun(scene);
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const laptop = simCaller(
    world,
    simAgent(editor, `${editor.personId ?? ''}/laptop`, { interactive: true }),
  );
  world.adapters.clock.advance(3 * minute);
  const subscribed = await itemInScope(scene, 'Write the run notes');
  await subscribedRun(scene, laptop, subscribed);
  world.adapters.clock.advance(4 * minute);
  const personHeld = await enqueued(scene, 'Review the copy');
  value(
    await world.kernel.items.claim(simCaller(world, scene.admin), {
      itemId: personHeld,
      delegationId: null,
    }),
  );
  const unheld = await enqueued(scene, 'Draw the icon');
  world.adapters.clock.advance(minute);
  return { ...scene, editor, laptop, metered: scene.itemId, subscribed, personHeld, unheld };
}

export function itemNow(world: World, itemId: string): Promise<ItemState | null> {
  return world.adapters.store.transaction((tx) => tx.harnessItems.read.byId(itemId));
}

export type GatesWorld = {
  readonly world: World;
  readonly harnessId: string;
  readonly ian: Principal;
  readonly areaAdmin: Principal;
  readonly viewer: Principal;
  readonly standard: string;
  readonly high: string;
  readonly atCheck: string;
};

const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

const aclChange = {
  pullRequest: { ...shipPullRequest, number: 44 },
  head: simSha('a11ce'),
  paths: ['packages/core/acl.ts'],
  declaration: { riskTier: 'high', riskDomains: ['acl'] },
} as const;

export async function gatesWorld(world: World): Promise<GatesWorld> {
  const { harness, admin: ian } = await createSimHarness(world, software);
  const editor = await simPerson(world, 2, [{ role: 'editor', ...area }]);
  const areaAdmin = await simPerson(world, 5, [{ role: 'admin', ...area }]);
  const viewer = await simPerson(world, 8, [{ role: 'viewer', ...area }]);
  const harnessId = harness.id;
  const standardShip = { ...standardChange, pullRequest: { ...shipPullRequest, number: 43 } };
  const standard = await simParkedAtShip(world, {
    harnessId,
    editor,
    title: 'Show the board',
    change: standardShip,
  });
  const high = await simParkedAtShip(world, {
    harnessId,
    editor,
    title: 'Tighten the access check',
    change: { ...aclChange, declaration: { riskTier: 'high', riskDomains: ['acl'] } },
  });
  const atCheck = await simParkedAtCheck(world, { harnessId, admin: ian, title: 'Check the copy' });
  return {
    world,
    harnessId,
    ian,
    areaAdmin,
    viewer,
    standard: standard.itemId,
    high: high.itemId,
    atCheck: atCheck.itemId,
  };
}

export type Waiting = RunWorld & { readonly editor: Principal; readonly failedRun: string };

const hour = 3_600_000;

export async function grantScout(scene: RunWorld, expiresAt: Date | null) {
  const granted = await simDelegate(scene.world, scene.owner, {
    harnessId: scene.harnessId,
    persona: 'agent:scout',
    capability: 'build',
    expiresAt,
    supersedes: null,
  });
  return value(granted);
}

export async function waitingScene(world: World): Promise<Waiting> {
  const scene = await runWorld(world);
  const editor = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  await simParkedAtShip(world, {
    harnessId: scene.harnessId,
    editor,
    title: 'Show the board',
    change: standardChange,
  });
  const { runId } = value(await startOn(scene));
  const failure = { step: 'work' as const, why: 'retries_exhausted' as const, detail: null };
  value(await world.kernel.runs.fail(systemCaller(scene), runId, failure));
  await grantScout(scene, new Date(world.adapters.clock.now().getTime() + hour));
  world.adapters.clock.advance(2 * hour);
  return { ...scene, editor, failedRun: runId };
}

export type Played = {
  readonly world: World;
  readonly itemId: string;
  readonly editor: Principal;
  readonly laptop: Caller;
};

export const shownLearning = '00000000-0000-4000-8000-000000008101';
export const elsewhereLearning = '00000000-0000-4000-8000-000000008102';

async function seedLearnings(world: World): Promise<void> {
  const page = { bodyMd: '- [inferred] one claim', type: 'learning', status: 'suggested' } as const;
  const frontmatter = { as_of: '2026-09-01', supersedes: [], review_by: null };
  await seedPage(world.database.db, {
    ...page,
    id: shownLearning,
    jdArea: '80-89',
    slug: 'play-shown',
    title: 'Shown learning',
    frontmatter: { ...frontmatter, confidence: 'inferred' },
  });
  await seedPage(world.database.db, {
    ...page,
    id: elsewhereLearning,
    jdArea: '20-29',
    slug: 'play-elsewhere',
    title: 'Learning from another area',
    frontmatter: { ...frontmatter, confidence: 'assumed' },
  });
}

async function steppedItem(world: World, laptop: Caller, itemId: string): Promise<void> {
  value(await world.kernel.items.claim(laptop, { itemId, delegationId: null }));
  const runId = world.adapters.ids.next();
  for (let n = 0; n < 101; n += 1) {
    const step = { itemId, runId, step: 'work' as const, tokensIn: 10, tokensOut: 5 };
    value(await world.kernel.items.recordRunStep(laptop, { ...step, costBasis: 'subscription' }));
  }
}

export async function playedScene(world: World): Promise<Played> {
  const { harness, admin } = await createSimHarness(world, software);
  const pickup = {
    harnessId: harness.id,
    stageKey: 'package',
    change: { agentPickup: 'allowed' as const },
  };
  value(await world.kernel.stages.updateStage(simCaller(world, admin), pickup));
  await seedLearnings(world);
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const caller = simCaller(world, editor);
  const enqueued = await world.kernel.items.enqueue(caller, {
    harnessId: harness.id,
    title: 'Write the run notes',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const { itemId } = value(enqueued);
  const laptop = simCaller(
    world,
    simAgent(editor, `${editor.personId ?? ''}/laptop`, { interactive: true }),
  );
  await steppedItem(world, laptop, itemId);
  for (const pageId of [shownLearning, elsewhereLearning]) {
    value(await world.kernel.items.attachLearning(caller, { itemId, pageId, delegationId: null }));
  }
  return { world, itemId, editor, laptop };
}
