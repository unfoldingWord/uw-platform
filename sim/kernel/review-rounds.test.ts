import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { reviewHead, reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, itemOf, reasonOf, startOn, value } from '../runs.ts';
import { greenFacts } from '../ship-fixtures.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const changes = {
  verdict: 'request_changes' as const,
  findings: [{ text: 'The board change drops the empty state.', weight: 'real' as const }],
  resolvedProvider: 'deepinfra',
  resolvedModel: 'z-ai/glm-5.3',
};

async function inWorld(work: (scene: ReviewWorld) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await reviewWorld(world));
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

async function round(
  scene: ReviewWorld,
  runId: string | null,
  verdict: 'request_changes' | 'approve' = 'request_changes',
): Promise<void> {
  const id = runId ?? value(await startOn(scene)).runId;
  value(await scene.world.kernel.runs.postReview(scene.host, id, { ...changes, verdict }));
}

async function namesOf(scene: ReviewWorld): Promise<readonly string[]> {
  return (await itemEvents(scene, scene.itemId)).map((event) => event.name);
}

async function handsOff(scene: ReviewWorld): Promise<void> {
  await round(scene, scene.runId);
  await round(scene, null);
  expect(await namesOf(scene)).not.toContain('handed_to_person');
  await round(scene, null);
  const events = await itemEvents(scene, scene.itemId);
  const tail = events.slice(-4);
  expect(tail.map((event) => event.name)).toEqual([
    'run_completed',
    'item_released',
    'checks_failed',
    'handed_to_person',
  ]);
  expect(new Set(tail.map((event) => event.traceId)).size).toBe(1);
  expect(tail[2]?.evidence).toEqual({ stage: 'check', failures: ['review_rounds_exhausted'] });
  const personId = scene.owner.personId ?? '';
  expect(tail[3]?.evidence).toEqual({ personId, why: 'review_rounds_exhausted', rounds: 3 });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    holder: `human:${personId}`,
    claimantKind: 'person',
    leaseExpiresAt: null,
    delegationId: null,
  });
  expect(reasonOf(await startOn(scene))).not.toBeNull();
}

async function reenters(scene: ReviewWorld): Promise<void> {
  await round(scene, scene.runId);
  await round(scene, null);
  const admin = simCaller(scene.world, scene.admin);
  const change = { feeds: ['check'] };
  const stage = { harnessId: scene.harnessId, stageKey: 'check', change };
  value(await scene.world.kernel.stages.updateStage(admin, stage));
  const { itemId } = scene;
  value(await scene.world.kernel.items.claim(admin, { itemId, delegationId: null }));
  value(
    await scene.world.kernel.items.submit(admin, {
      itemId,
      to: 'check',
      evidence: {},
      change: null,
    }),
  );
  await round(scene, null);
  await round(scene, null);
  expect(await namesOf(scene)).not.toContain('handed_to_person');
  await round(scene, null);
  expect((await namesOf(scene)).filter((name) => name === 'handed_to_person')).toHaveLength(1);
}

async function approvalsAndReuse(scene: ReviewWorld): Promise<void> {
  await round(scene, scene.runId);
  await round(scene, null, 'approve');
  const reused = greenFacts(scene.world, {
    itemId: scene.itemId,
    head: reviewHead,
    reviews: [
      {
        reviewId: 9200000001,
        reviewer: 'uw-reviewer[bot]',
        commit: reviewHead,
        state: 'changes_requested',
        provider: 'deepinfra',
        findings: [],
        submittedAt: null,
      },
    ],
  });
  scene.world.adapters.githubFacts.given(reused);
  await round(scene, null);
  await round(scene, null);
  expect(await namesOf(scene)).not.toContain('handed_to_person');
  const completed = (await itemEvents(scene, scene.itemId)).filter(
    (event) => event.name === 'run_completed',
  );
  expect(
    completed.map((event) => (event.evidence['review'] as { reviewId: number }).reviewId),
  ).toEqual([9200000001, 9200000002, 9200000001, 9200000001]);
}

describe('review rounds', () => {
  it('PE-6 the third request_changes round hands the item to the delegating person', () =>
    inWorld(handsOff));
  it('PE-6 rounds count only since the item last entered its stage', () => inWorld(reenters));
  it('PE-6 an approve does not count as a round, and a reused review does not count twice', () =>
    inWorld(approvalsAndReuse));
});
