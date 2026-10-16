import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAdvance, simCaller, simSystem } from '../fixtures.ts';
import { reviewHead, reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { beatOf, itemOf, stepOn, value } from '../runs.ts';
import { shipPullRequest } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const minute = 60_000;

async function waitingBeside(scene: ReviewWorld): Promise<string> {
  const { world, harnessId, admin } = scene;
  const caller = simCaller(world, admin);
  const { itemId } = value(
    await world.kernel.items.enqueue(caller, {
      harnessId,
      title: 'Wait beside the reviewed one',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await simAdvance(world, {
    harnessId,
    itemId,
    worker: admin,
    through: ['package', 'scope', 'plan', 'build'],
  });
  return itemId;
}

async function levelOf(scene: ReviewWorld): Promise<string> {
  const silences = await scene.world.kernel.views.silence();
  return silences.find((silence) => silence.harness.id === scene.harnessId)?.level ?? 'missing';
}

async function waitingIn(scene: ReviewWorld): Promise<readonly string[]> {
  const silences = await scene.world.kernel.views.silence();
  const mine = silences.find((silence) => silence.harness.id === scene.harnessId);
  return mine?.waiting.map((entry) => entry.item.itemId) ?? [];
}

async function withScene(
  setup: { readonly capability?: 'review' | 'build' },
  work: (scene: ReviewWorld, waiting: string) => Promise<void>,
): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await reviewWorld(world, setup);
    await work(scene, await waitingBeside(scene));
  } finally {
    await world.close();
  }
}

const approve = {
  verdict: 'approve' as const,
  findings: [{ text: 'The board change reads well.', weight: 'theoretical' as const }],
  resolvedProvider: 'deepinfra',
  resolvedModel: 'z-ai/glm-5.3',
};

async function inReviewWorld(work: (scene: ReviewWorld) => Promise<void>): Promise<void> {
  const world: World = await createWorld();
  try {
    await work(await reviewWorld(world));
  } finally {
    await world.close();
  }
}

async function reviewed(scene: ReviewWorld): Promise<void> {
  value(await scene.world.kernel.runs.postReview(scene.host, scene.runId, approve));
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
}

async function sounded(scene: ReviewWorld): Promise<readonly string[]> {
  const system = simCaller(scene.world, simSystem());
  return value(await scene.world.kernel.alarms.soundSilence(system, { limit: 10 })).sounded;
}

async function reviewedNotWaiting(scene: ReviewWorld): Promise<void> {
  await reviewed(scene);
  expect((await itemOf(scene.world, scene.itemId))?.stageKey).toBe('check');
  scene.world.adapters.clock.advance(91 * minute);
  expect(await waitingIn(scene)).toEqual([]);
  expect(await levelOf(scene)).toBe('ok');
  expect(await sounded(scene)).toEqual([]);
}

async function backToCheck(scene: ReviewWorld): Promise<void> {
  const { world, harnessId, admin, itemId } = scene;
  const caller = simCaller(world, admin);
  const change = { feeds: ['build'] };
  value(await world.kernel.stages.updateStage(caller, { harnessId, stageKey: 'check', change }));
  value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
  value(
    await world.kernel.items.submit(caller, { itemId, to: 'build', evidence: {}, change: null }),
  );
  world.adapters.clock.advance(minute);
  value(await world.kernel.items.claim(caller, { itemId, delegationId: null }));
  const pull = { pullRequest: shipPullRequest, head: reviewHead };
  value(await world.kernel.items.submit(caller, { itemId, to: null, evidence: {}, change: pull }));
}

async function reviewedBeforeReentry(scene: ReviewWorld): Promise<void> {
  const beside = await waitingBeside(scene);
  await reviewed(scene);
  await backToCheck(scene);
  expect((await itemOf(scene.world, scene.itemId))?.stageKey).toBe('check');
  scene.world.adapters.clock.advance(91 * minute);
  expect([...(await waitingIn(scene))].sort()).toEqual([beside, scene.itemId].sort());
  expect(await levelOf(scene)).toBe('red');
  expect(await sounded(scene)).toEqual([scene.harnessId]);
}

describe('OB-1 only review steps quiet the alarm', () => {
  it('OB-1 a Reviewer stepping every ten minutes keeps a waiting item from going red, and silence turns it red', () =>
    withScene({}, async (scene) => {
      const beat = await beatOf(scene);
      for (let tick = 0; tick < 9; tick += 1) {
        scene.world.adapters.clock.advance(10 * minute);
        value(await stepOn(scene, beat, { runId: scene.runId, step: 'read' }));
      }
      scene.world.adapters.clock.advance(minute);
      expect(await levelOf(scene)).toBe('ok');
      scene.world.adapters.clock.advance(91 * minute);
      expect(await levelOf(scene)).toBe('red');
    }));

  it('OB-1 a build run stepping does not count as a review step', () =>
    withScene({ capability: 'build' }, async (scene) => {
      const beat = await beatOf(scene);
      for (let tick = 0; tick < 9; tick += 1) {
        scene.world.adapters.clock.advance(10 * minute);
        value(await stepOn(scene, beat, { runId: scene.runId, step: 'read' }));
      }
      scene.world.adapters.clock.advance(minute);
      expect(await levelOf(scene)).toBe('red');
    }));

  it('OB-1 an item reviewed since it entered Check is not waiting, and nothing sounds', () =>
    inReviewWorld(reviewedNotWaiting));

  it('OB-1 a review completed before the item came back to Check does not quiet it', () =>
    inReviewWorld(reviewedBeforeReentry));
});
