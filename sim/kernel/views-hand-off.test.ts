import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedHandOffs } from '@uw/db/test-seed';
import type { Principal } from '@uw/contracts';
import { VIEW_LIMIT } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { reviewWorld, type ReviewWorld } from '../review-runs.ts';
import { startOn, value } from '../runs.ts';
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
  } finally {
    await world.close();
  }
}

async function handedOff(scene: ReviewWorld): Promise<void> {
  const rounds = [scene.runId, null, null];
  for (const runId of rounds) {
    const id = runId ?? value(await startOn(scene)).runId;
    value(await scene.world.kernel.runs.postReview(scene.host, id, changes));
  }
}

async function handOffRows(scene: ReviewWorld, person: Principal) {
  const waiting = await scene.world.kernel.views.waitingOn(simCaller(scene.world, person));
  return waiting.rows.flatMap((row) =>
    row.kind === 'handed_to_person' ? [{ itemId: row.item.itemId, rounds: row.rounds }] : [],
  );
}

async function crowded(scene: ReviewWorld): Promise<void> {
  const { world } = scene;
  await seedHandOffs(world.database.db, {
    harnessId: scene.harnessId,
    personId: personOf(scene.admin),
    count: VIEW_LIMIT,
    at: new Date(world.adapters.clock.now().getTime() - 60_000),
  });
}

function personOf(principal: Principal): string {
  if (principal.personId === null) throw new TypeError('a person has a person id');
  return principal.personId;
}

describe('a hand-off after three review rounds on Home', () => {
  it('lists the item for the person it was handed to, and for no one else', () =>
    inWorld(async (scene) => {
      await handedOff(scene);
      expect(await handOffRows(scene, scene.owner)).toEqual([{ itemId: scene.itemId, rounds: 3 }]);
      expect(await handOffRows(scene, scene.admin)).toEqual([]);
    }));

  it('reads only hand-offs to the viewer, so hand-offs to other people never fill the read', () =>
    inWorld(async (scene) => {
      await handedOff(scene);
      await crowded(scene);
      const waiting = await scene.world.kernel.views.waitingOn(simCaller(scene.world, scene.owner));
      expect(waiting.handedCapped).toBe(false);
      expect(await handOffRows(scene, scene.owner)).toEqual([{ itemId: scene.itemId, rounds: 3 }]);
    }));

  it('drops the row once the person lets the item go', () =>
    inWorld(async (scene) => {
      await handedOff(scene);
      const owner = simCaller(scene.world, scene.owner);
      value(
        await scene.world.kernel.items.release(owner, { itemId: scene.itemId, delegationId: null }),
      );
      expect(await handOffRows(scene, scene.owner)).toEqual([]);
    }));
});
