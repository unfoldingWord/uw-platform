import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simAdvance, simCaller, simSystem } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { beatOf, stepOn, value } from '../runs.ts';
import { createWorld } from '../world.ts';

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

  it('OB-1 an item reviewed since it entered Check is not waiting', () =>
    withScene({}, async (scene, waiting) => {
      expect(await waitingIn(scene)).toEqual([waiting]);
      const system = simCaller(scene.world, simSystem());
      expect(
        value(await scene.world.kernel.alarms.soundSilence(system, { limit: 10 })).sounded,
      ).toEqual([]);
    }));
});
