import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { parseReviewProvider } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { readSpend, simAgent, simCaller } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import { diffOf, reviewHead, reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { detailOf, itemEvents, itemOf, reasonOf, runOf, value } from '../runs.ts';
import { approvedBy, greenFacts } from '../ship-fixtures.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Setup = Parameters<typeof reviewWorld>[1];

async function inWorld(
  work: (scene: ReviewWorld) => Promise<void>,
  setup: Setup = {},
): Promise<void> {
  const world = await createWorld();
  try {
    await work(await reviewWorld(world, setup));
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

const approve = {
  verdict: 'approve' as const,
  findings: ['The board change reads well.'],
  resolvedProvider: 'deepinfra',
  resolvedModel: 'z-ai/glm-5.3',
};

function post(scene: ReviewWorld, input: Partial<typeof approve> = {}) {
  return scene.world.kernel.runs.postReview(scene.host, scene.runId, { ...approve, ...input });
}

async function lastRunEvent(scene: ReviewWorld) {
  const events = await itemEvents(scene, scene.itemId);
  return events.filter((event) => event.name === 'run_completed').at(-1);
}

async function postsOnHead(scene: ReviewWorld): Promise<void> {
  const run = value(await post(scene));
  expect(run.outcome).toBe('completed');
  const [review] = scene.world.adapters.connectors.reviews();
  expect(review).toMatchObject({
    reviewer: 'uw-reviewer',
    repository: 'unfoldingWord/uw-platform',
    pullRequest: scene.ref,
    head: reviewHead,
    verdict: 'approve',
    traceId: run.traceId,
  });
  expect(review?.body.startsWith('```harness-review\n')).toBe(true);
  expect(parseReviewProvider(review?.body ?? null)).toBe('deepinfra');
  expect((await lastRunEvent(scene))?.evidence).toMatchObject({
    result: 'review_posted',
    review: {
      reviewer: 'uw-reviewer',
      provider: 'deepinfra',
      model: 'z-ai/glm-5.3',
      verdict: 'approve',
      reviewId: 9200000001,
    },
  });
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
}

async function withheldOnMismatch(scene: ReviewWorld): Promise<void> {
  value(await post(scene, { resolvedProvider: 'together' }));
  expect(scene.world.adapters.connectors.reviews()).toEqual([]);
  expect((await lastRunEvent(scene))?.evidence).toMatchObject({
    result: 'review_withheld',
    review: null,
  });
}

async function overBudget(scene: ReviewWorld): Promise<void> {
  diffOf(scene, 'x'.repeat(80_001));
  const answer = value(await scene.world.kernel.runs.reviewDiff(scene.host, scene.runId));
  expect(answer).toEqual({ ended: 'review_refused' });
  const events = await itemEvents(scene, scene.itemId);
  const tail = events.slice(-3);
  expect(tail.map((event) => event.name)).toEqual([
    'checks_failed',
    'run_completed',
    'item_released',
  ]);
  expect(tail[0]?.evidence).toEqual({ stage: 'check', failures: ['diff_exceeds_review_budget'] });
  expect(tail[1]?.evidence).toMatchObject({ result: 'review_refused' });
  expect(await itemOf(scene.world, scene.itemId)).toMatchObject({
    gateStatus: 'checks_failed',
    holder: null,
  });
  const agent = simAgent(scene.admin, `${scene.admin.personId ?? ''}/laptop`, {
    interactive: true,
  });
  const claim = (caller: ReturnType<typeof simCaller>) =>
    scene.world.kernel.items.claim(caller, { itemId: scene.itemId, delegationId: null });
  const refused = await claim(simCaller(scene.world, agent));
  expect(reasonOf(refused)).toBe('not_permitted');
  expect(detailOf(refused)).toEqual({ why: 'held_for_person' });
  const polled = await scene.world.kernel.reads.poll(simCaller(scene.world, agent), {
    harnessId: scene.harnessId,
    limit: 50,
  });
  expect(value(polled).map((item) => item.itemId)).not.toContain(scene.itemId);
  value(await claim(simCaller(scene.world, scene.admin)));
}

async function noSecondReview(scene: ReviewWorld): Promise<void> {
  value(await post(scene));
  await readSpend(scene.world);
  const beaten = value(await scene.world.kernel.runs.beat(scene.host, { limit: 10 }));
  expect(beaten.started).toEqual([]);
  expect(scene.world.adapters.connectors.reviews()).toHaveLength(1);
}

async function secondIdentity(scene: ReviewWorld): Promise<void> {
  const codex = approvedBy('uw-reviewer-codex[bot]', 'DeepInfra', reviewHead, 9300000001);
  scene.world.adapters.githubFacts.given(
    greenFacts(scene.world, { itemId: scene.itemId, head: reviewHead, reviews: [codex] }),
  );
  value(await post(scene));
  expect(scene.world.adapters.connectors.reviews()).toEqual([]);
  expect((await lastRunEvent(scene))?.evidence).toMatchObject({ result: 'review_withheld' });
}

async function ownReviewReused(scene: ReviewWorld): Promise<void> {
  const elsewhere = approvedBy('uw-reviewer[bot]', 'DeepInfra', 'b'.repeat(40), 9300000003);
  const own = approvedBy('uw-reviewer[bot]', 'DeepInfra', reviewHead, 9300000002);
  scene.world.adapters.githubFacts.given(
    greenFacts(scene.world, { itemId: scene.itemId, head: reviewHead, reviews: [elsewhere, own] }),
  );
  value(await post(scene));
  expect(scene.world.adapters.connectors.reviews()).toEqual([]);
  expect((await lastRunEvent(scene))?.evidence).toMatchObject({
    result: 'review_posted',
    review: {
      reviewer: 'uw-reviewer',
      provider: 'deepinfra',
      model: 'z-ai/glm-5.3',
      verdict: 'approve',
      reviewId: 9300000002,
    },
  });
}

async function otherHeadNotReused(scene: ReviewWorld): Promise<void> {
  const elsewhere = approvedBy('uw-reviewer[bot]', 'DeepInfra', 'b'.repeat(40), 9300000003);
  scene.world.adapters.githubFacts.given(
    greenFacts(scene.world, { itemId: scene.itemId, head: reviewHead, reviews: [elsewhere] }),
  );
  value(await post(scene));
  expect(scene.world.adapters.connectors.reviews()).toHaveLength(1);
}

async function notAReviewRun(scene: ReviewWorld): Promise<void> {
  const before = (await itemEvents(scene, scene.itemId)).length;
  const posted = await post(scene);
  expect(reasonOf(posted)).toBe('not_permitted');
  expect(detailOf(posted)).toEqual({ why: 'not_a_review_run' });
  const read = await scene.world.kernel.runs.reviewDiff(scene.host, scene.runId);
  expect(detailOf(read)).toEqual({ why: 'not_a_review_run' });
  expect(scene.world.adapters.connectors.reviews()).toEqual([]);
  expect((await itemEvents(scene, scene.itemId)).length).toBe(before);
  expect((await runOf(scene.world, scene.runId))?.outcome).toBe('running');
}

async function readsTheDiff(scene: ReviewWorld): Promise<void> {
  diffOf(scene, 'diff --git a/board.tsx b/board.tsx\n');
  const answer = value(await scene.world.kernel.runs.reviewDiff(scene.host, scene.runId));
  expect(answer).toEqual({ diff: 'diff --git a/board.tsx b/board.tsx\n' });
  expect((await runOf(scene.world, scene.runId))?.outcome).toBe('running');
  const persona = simCaller(scene.world, scene.persona);
  expect(reasonOf(await scene.world.kernel.runs.reviewDiff(persona, scene.runId))).toBe(
    'not_permitted',
  );
}

async function noReviewer(world: World): Promise<void> {
  const scene = await reviewWorld(world, { engine: 'claude-messages', provider: null });
  value(await post(scene, { resolvedProvider: 'anthropic' }));
  expect(scene.world.adapters.connectors.reviews()).toHaveLength(1);
}

describe('a review run reads the diff at the head and posts or withholds its review', () => {
  it('HE-4 a review run posts a review on the expected head whose body opens with the harness-review block', () =>
    inWorld(postsOnHead));

  it('HE-4 a review whose resolved provider is not the pinned one is withheld', () =>
    inWorld(withheldOnMismatch));

  it("HE-4 a diff over the budget fails the item's checks with diff_exceeds_review_budget and releases it for a person", () =>
    inWorld(overBudget));

  it("HE-9 a second Reviewer identity whose provider equals the first review's withholds its review", () =>
    inWorld(secondIdentity));

  it('HE-4 a run that is not a review run cannot post one', () =>
    inWorld(notAReviewRun, { capability: 'build' }));

  it('a review run whose Reviewer already reviewed the head reuses that review and posts none', () =>
    inWorld(ownReviewReused));

  it("a review run posts when its Reviewer's only review is on another head", () =>
    inWorld(otherHeadNotReused));

  it('the beat does not start a second review of a head its Reviewer already reviewed', () =>
    inWorld(noSecondReview));

  it('a review run reads the diff of the head against the base, and only the run host may ask', () =>
    inWorld(readsTheDiff));

  it('a claude-messages review run posts as the Reviewer its engine names, pinned to anthropic', async () => {
    const world = await createWorld();
    try {
      await noReviewer(world);
    } finally {
      await world.close();
    }
  });
});
