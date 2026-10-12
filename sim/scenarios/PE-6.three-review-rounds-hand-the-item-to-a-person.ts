import assert from 'node:assert/strict';
import { simAgent, simCaller } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { itemEvents, itemOf, reasonOf, startOn, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

const changes = {
  verdict: 'request_changes' as const,
  findings: ['The board change drops the empty state.'],
  resolvedProvider: 'deepinfra',
  resolvedModel: 'z-ai/glm-5.3',
};

async function round(scene: ReviewWorld, runId: string | null): Promise<void> {
  const id = runId ?? value(await startOn(scene)).runId;
  value(await scene.world.kernel.runs.postReview(scene.host, id, changes));
}

export const scenario = defineScenario({
  id: 'PE-6',
  title:
    'three request_changes rounds by the Reviewer on an item at check hand it to the person who delegated the Reviewer: checks_failed names review_rounds_exhausted, the person holds the item with no lease, and the Reviewer cannot claim it',
  run: async (world) => {
    const scene = await reviewWorld(world);
    await round(scene, scene.runId);
    await round(scene, null);
    await round(scene, null);
    assert.equal(world.adapters.connectors.reviews().length, 3);
    const events = await itemEvents(scene, scene.itemId);
    const names = events.map((event) => event.name);
    assert.deepEqual(names.slice(-2), ['checks_failed', 'handed_to_person']);
    const personId = scene.owner.personId ?? '';
    assert.deepEqual(events.at(-1)?.evidence, {
      personId,
      why: 'review_rounds_exhausted',
      rounds: 3,
    });
    assert.deepEqual(events.at(-2)?.evidence, {
      stage: 'check',
      failures: ['review_rounds_exhausted'],
    });
    const item = await itemOf(world, scene.itemId);
    assert.deepEqual(
      [item?.holder, item?.claimantKind, item?.leaseExpiresAt],
      [`human:${personId}`, 'person', null],
    );
    const reviewer = simAgent(scene.owner, 'reviewer', { interactive: false });
    const claim = await world.kernel.items.claim(simCaller(world, reviewer), {
      itemId: scene.itemId,
      delegationId: scene.delegationId,
    });
    assert.equal(reasonOf(claim), 'lease_held');
    return { state: { item, events: names } };
  },
});
