import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { readAllEvents } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simAdvance, simCaller } from '../fixtures.ts';
import {
  approveVerdict,
  joinedHead,
  joinedPull,
  joinedWorld,
  startReview,
  type JoinedWorld,
} from '../joining.ts';
import { reasonOf, value } from '../runs.ts';
import { itemLog } from '../ship-fixtures.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inShadow(work: (scene: JoinedWorld) => Promise<void>, shadow = true): Promise<void> {
  const world = await createWorld();
  try {
    await work(await joinedWorld(world, { shadow }));
  } finally {
    await world.close();
  }
}

async function named(scene: JoinedWorld, name: string) {
  const events = await scene.world.adapters.store.transaction((tx) =>
    readAllEvents(tx, scene.harnessId, scene.itemId),
  );
  return events.filter((event) => event.name === name);
}

async function evidenceOf(scene: JoinedWorld, name: string) {
  return (await named(scene, name)).map((event) => event.evidence);
}

function recordVerdicts(scene: JoinedWorld) {
  return scene.world.kernel.gates.recordShadowVerdicts(scene.ingest, { pullRequest: joinedPull });
}

describe('GL-4 shadow mode', () => {
  it('records the Reviewer verdict as review_verdict_recorded and posts no GitHub review', () =>
    inShadow(async (scene) => {
      const runId = await startReview(scene);
      const run = value(
        await scene.world.kernel.runs.postReview(scene.host, runId, approveVerdict),
      );
      expect(run.outcome).toBe('completed');
      expect(scene.world.adapters.connectors.reviews()).toEqual([]);
      const [recorded] = await named(scene, 'review_verdict_recorded');
      expect(recorded?.evidence).toMatchObject({
        runId,
        head: joinedHead,
        reviewer: 'uw-reviewer',
        verdict: 'approve',
      });
      const [completed] = await named(scene, 'run_completed');
      expect(completed?.evidence).toMatchObject({
        result: 'review_withheld',
        review: { reviewId: null, verdict: 'approve' },
      });
    }));

  it('evaluates the ship rule on the head as shadow_verdict, once per change', () =>
    inShadow(async (scene) => {
      expect(value(await recordVerdicts(scene))).toHaveLength(1);
      expect(value(await recordVerdicts(scene))).toHaveLength(0);
      const runId = await startReview(scene);
      value(await scene.world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      const verdicts = await evidenceOf(scene, 'shadow_verdict');
      expect(verdicts).toEqual([
        { head: joinedHead, verdict: 'refuse', reasons: ['no_reviewer_approval'] },
        { head: joinedHead, verdict: 'advance', reasons: [] },
      ]);
    }));
});

describe('GL-4 shadow mode writes nothing', () => {
  it('calls no GitHub write port method in shadow mode, and refuses the Ship approval', () =>
    inShadow(async (scene) => {
      const { world, admin, harnessId, itemId } = scene;
      value(await recordVerdicts(scene));
      const runId = await startReview(scene);
      value(await world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      const parked = await simAdvance(world, {
        harnessId,
        itemId,
        worker: admin,
        through: ['check', 'ship'],
      });
      expect(parked).toMatchObject({ stageKey: 'ship', gateStatus: 'parked' });
      for (const decision of ['approve', 'override'] as const) {
        const refused = await world.kernel.gates.decide(simCaller(world, admin), {
          itemId,
          decision,
          reason: decision === 'override' ? 'The owner accepts the risk.' : null,
          findings: [],
          seenHead: joinedHead,
        });
        expect(reasonOf(refused)).toBe('not_permitted');
        expect(refused).toMatchObject({ detail: { why: 'shadow' } });
      }
      expect(world.adapters.connectors.calls()).toEqual([]);
      expect(world.adapters.connectors.reviews()).toEqual([]);
      expect((await itemLog(world, harnessId, itemId)).decisions).toEqual([]);
    }));
});

describe('GL-4 shadow mode ends at the lift', () => {
  it('posts the review once shadow is lifted', () =>
    inShadow(async (scene) => {
      const lift = simCaller(scene.world, scene.admin);
      value(await scene.world.kernel.stages.liftShadow(lift, { harnessId: scene.harnessId }));
      const runId = await startReview(scene);
      value(await scene.world.kernel.runs.postReview(scene.host, runId, approveVerdict));
      expect(scene.world.adapters.connectors.reviews()).toHaveLength(1);
      expect(await named(scene, 'review_verdict_recorded')).toEqual([]);
    }));

  it('records no shadow verdict on a harness that is not in shadow', () =>
    inShadow(async (scene) => {
      expect(value(await recordVerdicts(scene))).toEqual([]);
    }, false));
});
