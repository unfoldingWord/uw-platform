import type { Principal } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { software, type Caller } from '@uw/harness';
import { createSimHarness, readSpend, simAgent, simCaller, simPerson } from './fixtures.ts';
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
import { grantScout } from './views.ts';
import type { World } from './world.ts';

export const planeStart = new Date('2026-09-30T23:30:00.000Z');

const hour = 3_600_000;

export type PlaneWorld = RunWorld & {
  readonly editor: Principal;
  readonly laptop: Caller;
  readonly scoutExpiry: Date;
  readonly elsewhereId: string;
};

async function lastMonthRun(scene: RunWorld): Promise<void> {
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await stepOn(scene, beat, { runId, step: 'work' }));
  const failure = { step: 'work' as const, why: 'retries_exhausted' as const, detail: null };
  value(await scene.world.kernel.runs.fail(systemCaller(scene), runId, failure));
}

async function todayRun(scene: RunWorld): Promise<void> {
  const itemId = await itemInScope(scene, 'Write the release notes');
  const { runId } = value(await startOn(scene, { itemId }));
  const beat = await beatOf(scene);
  for (const step of ['read', 'work'] as const) {
    value(await stepOn({ world: scene.world, itemId }, beat, { runId, step }));
  }
}

async function subscribedRun(scene: RunWorld, laptop: Caller): Promise<void> {
  const itemId = await itemInScope(scene, 'Draw the icon');
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

async function elsewhereDelegation(scene: RunWorld): Promise<string> {
  const { harness, admin } = await createSimHarness(scene.world, software, {
    key: 'elsewhere',
    jdArea: '20-29',
  });
  const granted = await scene.world.kernel.delegations.grant(simCaller(scene.world, admin), {
    harnessId: harness.id,
    persona: 'agent:scout',
    capability: 'build',
    expiresAt: null,
    supersedes: null,
  });
  value(granted);
  return harness.id;
}

export async function planeWorld(world: World): Promise<PlaneWorld> {
  const scene = await runWorld(world);
  await lastMonthRun(scene);
  world.adapters.clock.advance(hour);
  await readSpend(world);
  await todayRun(scene);
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const laptop = simCaller(
    world,
    simAgent(editor, `${editor.personId ?? ''}/laptop`, { interactive: true }),
  );
  await subscribedRun(scene, laptop);
  const scout = await grantScout(scene, new Date(world.adapters.clock.now().getTime() + 3 * hour));
  const elsewhereId = await elsewhereDelegation(scene);
  return { ...scene, editor, laptop, scoutExpiry: scout.expiresAt, elsewhereId };
}

const learning = { bodyMd: '- [inferred] one claim', type: 'learning' } as const;

const learnings = [
  {
    id: '00000000-0000-4000-8000-000000008201',
    area: '80-89',
    status: 'suggested',
    confidence: 'inferred',
    asOf: '2026-06-01',
    reviewBy: null,
  },
  {
    id: '00000000-0000-4000-8000-000000008202',
    area: '80-89',
    status: 'active',
    confidence: 'assumed',
    asOf: '2026-09-01',
    reviewBy: '2026-12-01',
  },
  {
    id: '00000000-0000-4000-8000-000000008203',
    area: '80-89',
    status: 'active',
    confidence: 'verified',
    asOf: '2026-01-01',
    reviewBy: null,
  },
  {
    id: '00000000-0000-4000-8000-000000008204',
    area: '80-89',
    status: 'active',
    confidence: 'assumed',
    asOf: '2026-09-01',
    reviewBy: null,
  },
  {
    id: '00000000-0000-4000-8000-000000008206',
    area: '80-89',
    status: 'retired',
    confidence: 'assumed',
    asOf: '2026-01-01',
    reviewBy: null,
  },
  {
    id: '00000000-0000-4000-8000-000000008205',
    area: '20-29',
    status: 'active',
    confidence: 'assumed',
    asOf: '2026-01-01',
    reviewBy: '2026-09-29',
  },
] as const;

export async function seedPlaneLearnings(world: World): Promise<void> {
  for (const [n, page] of learnings.entries()) {
    await seedPage(world.database.db, {
      ...learning,
      id: page.id,
      status: page.status,
      jdArea: page.area,
      slug: `plane-learning-${n}`,
      title: `Learning ${n}`,
      frontmatter: {
        as_of: page.asOf,
        supersedes: [],
        review_by: page.reviewBy,
        confidence: page.confidence,
      },
    });
  }
}
