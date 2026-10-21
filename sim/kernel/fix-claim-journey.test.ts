import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import {
  claimFix,
  fixHead,
  fixWorld,
  offeredTo,
  pushedFix,
  reviewedRound,
  submitFix,
} from '../fix-claims.ts';
import { itemOf, startOn, value } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function twoRounds(world: World): Promise<void> {
  const scene = await fixWorld(world);
  value(await claimFix(scene));
  pushedFix(scene, {
    pull: { 'apps/uw-app/board.tsx': 40 },
    fix: { 'apps/uw-app/board.tsx': 6 },
  });
  expect(value(await submitFix(scene)).result).toBe('awaiting_review');
  expect(await offeredTo(scene, scene.fixer)).not.toContain(scene.itemId);
  const rerun = value(await startOn(scene));
  await reviewedRound({ ...scene, runId: rerun.runId, head: fixHead }, 'plausible');
  expect(await offeredTo(scene, scene.fixer)).toContain(scene.itemId);
  expect(await itemOf(world, scene.itemId)).toMatchObject({
    stageKey: 'check',
    expectedHead: fixHead,
  });
}

describe('FL-2 FL-3 a fix that passes waits for the next review round, which can open another fix', () => {
  it('FL-2 FL-3 round, fix, re-review at the new head, second round, second fix offered', async () => {
    const world = await createWorld();
    try {
      await twoRounds(world);
    } finally {
      await world.close();
    }
  });
});
