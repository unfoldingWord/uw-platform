import assert from 'node:assert/strict';
import {
  joinedChecks,
  liftAndPost,
  mergedUnderDelegation,
  protectedDirectory,
  refusedForProtectedPath,
  shadowRound,
  waitsForAPerson,
} from '../joining-journey.ts';
import { joinedWorld } from '../joining.ts';
import { defineScenario } from '../scenario.ts';
import { simLendMerge } from '../ship-fixtures.ts';

export const scenario = defineScenario({
  id: 'DX-10',
  title:
    'the joining journey: a check-only harness in shadow records the verdicts and posts nothing, the lift posts the review, Ship waits on a person, and a merge delegation merges a second joined pull request and is refused on a third that touches a protected path',
  run: async (world) => {
    const scene = await joinedWorld(world, {
      shadow: true,
      requiredChecks: joinedChecks,
      protectedPaths: [protectedDirectory],
    });
    const posted = () => world.adapters.connectors.reviews();
    const shadow = await shadowRound(scene, posted);
    assert.deepEqual(shadow, { shadowVerdicts: 2, recorded: 1, compared: 1 });
    const reviewsPosted = await liftAndPost(scene, posted);
    const waiting = await waitsForAPerson(scene);
    const loan = await simLendMerge(world, scene.admin, {
      harnessId: scene.harnessId,
      maxTier: 'standard',
    });
    const merged = await mergedUnderDelegation(scene, loan);
    const refused = await refusedForProtectedPath(scene, loan);
    return {
      state: {
        shadow,
        posted: reviewsPosted,
        waiting,
        merged: merged.joined,
        grantorApproved: merged.grantor === scene.admin.identity,
        refused: [...refused],
      },
    };
  },
});
