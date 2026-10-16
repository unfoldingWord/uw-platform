import type { ApproveAt, ReadFinding } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, reasonOf, runOf, startOn, value } from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

const theoretical: ReadFinding = {
  text: 'A year of clock skew would break the lease.',
  weight: 'theoretical',
};
const real: ReadFinding = { text: 'The board change drops the empty state.', weight: 'real' };

function review(verdict: 'approve' | 'request_changes', findings: readonly ReadFinding[]) {
  return { verdict, findings, resolvedProvider: 'deepinfra', resolvedModel: 'z-ai/glm-5.3' };
}

async function inWorld(
  approveAt: ApproveAt,
  work: (scene: ReviewWorld) => Promise<void>,
): Promise<void> {
  const world = await createWorld();
  try {
    await work(await reviewWorld(world, { approveAt }));
  } finally {
    await world.close();
  }
}

async function post(scene: ReviewWorld, runId: string | null, input: ReturnType<typeof review>) {
  const id = runId ?? value(await startOn(scene)).runId;
  return scene.world.kernel.runs.postReview(scene.host, id, input);
}

function postedVerdicts(scene: ReviewWorld): readonly string[] {
  return scene.world.adapters.connectors.reviews().map((one) => one.verdict);
}

async function refusesUnweighted(scene: ReviewWorld): Promise<void> {
  const unweighted = review('request_changes', [real, { text: 'No weight here.', weight: null }]);
  expect(reasonOf(await post(scene, scene.runId, unweighted))).toBe('finding_weight_missing');
  expect(scene.world.adapters.connectors.reviews()).toEqual([]);
  expect(await runOf(scene.world, scene.runId)).toMatchObject({
    outcome: 'failed',
    failure: 'finding_weight_missing',
  });
}

async function postsWeighted(scene: ReviewWorld): Promise<void> {
  value(await post(scene, scene.runId, review('request_changes', [real])));
  const [posted] = scene.world.adapters.connectors.reviews();
  expect(posted?.verdict).toBe('request_changes');
  expect(posted?.body).toContain('- real: The board change drops the empty state.');
  const events = await itemEvents(scene, scene.itemId);
  const completed = events.findLast((event) => event.name === 'run_completed');
  expect(completed?.evidence['review']).toMatchObject({ findings: [real] });
}

async function theoreticalNeverCounts(scene: ReviewWorld): Promise<void> {
  value(await post(scene, scene.runId, review('request_changes', [theoretical])));
  value(await post(scene, null, review('request_changes', [theoretical])));
  value(await post(scene, null, review('request_changes', [theoretical])));
  const names = (await itemEvents(scene, scene.itemId)).map((event) => event.name);
  expect(names.filter((name) => name === 'run_completed')).toHaveLength(3);
  expect(names).not.toContain('handed_to_person');
}

describe('RV-1 finding weight', () => {
  it('RV-1 refuses a verdict with an unweighted finding finding_weight_missing, posts nothing and fails the run', () =>
    inWorld('no_real_or_plausible', refusesUnweighted));

  it('RV-1 posts each finding with its weight and records the findings on the run', () =>
    inWorld('no_real_or_plausible', postsWeighted));

  it('RV-1 records theoretical-only verdicts and never counts them as review rounds', () =>
    inWorld('no_real_or_plausible', theoreticalNeverCounts));

  it('RV-1 records no findings as a success: approve is posted', () =>
    inWorld('no_real_or_plausible', async (scene) => {
      value(await post(scene, scene.runId, review('request_changes', [])));
      expect(postedVerdicts(scene)).toEqual(['approve']);
    }));
});

describe('RV-3 the strictness preset on the persona page', () => {
  it('RV-3 zero_findings posts request_changes on a theoretical finding the model approved', () =>
    inWorld('zero_findings', async (scene) => {
      value(await post(scene, scene.runId, review('approve', [theoretical])));
      expect(postedVerdicts(scene)).toEqual(['request_changes']);
    }));

  it('RV-3 no_real_or_plausible keeps the approve on a theoretical finding', () =>
    inWorld('no_real_or_plausible', async (scene) => {
      value(await post(scene, scene.runId, review('approve', [theoretical])));
      expect(postedVerdicts(scene)).toEqual(['approve']);
    }));
});
