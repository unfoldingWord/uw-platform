import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { dropDecisionNext } from '@uw/db/test-seed';
import { afterAll, describe, expect } from 'vitest';
import { simCaller } from '../fixtures.ts';
import {
  lostApproval,
  logOf,
  recoverAs,
  sceneIt,
  sixteenMinutes,
  type Scene,
} from './recover-scene.ts';

afterAll(closeEmbeddedTemplate);

async function spareAfterShip(scene: Scene): Promise<void> {
  const stages = await scene.world.adapters.store.transaction((tx) =>
    tx.harnessStages.read.forHarness(scene.harnessId),
  );
  const ship = stages.find((stage) => stage.key === 'ship');
  if (ship === undefined) throw new Error('no ship stage');
  const created = await scene.world.kernel.stages.createStage(simCaller(scene.world, scene.ian), {
    harnessId: scene.harnessId,
    stage: {
      key: 'spare',
      title: 'Spare',
      position: ship.position + 5,
      bracket: 'iterate',
      agentPickup: 'allowed',
      exitGate: 'checks',
      connector: 'none',
      wipLimit: 3,
      instructionsPageId: null,
      validators: [],
      feeds: [],
    },
  });
  expect(created.status).toBe('accepted');
}

describe('GH-6 a recovery advances to the stage the decision routed to', () => {
  sceneIt(
    'takes the item to the next stage fixed at the decision after a stage is inserted after Ship',
    async (scene) => {
      await lostApproval(scene, true);
      await spareAfterShip(scene);
      scene.world.adapters.clock.advance(sixteenMinutes);
      expect(await recoverAs(scene, scene.ian)).toEqual({
        status: 'accepted',
        value: { items: [{ itemId: scene.itemId, outcome: 'succeeded' }] },
      });
      const advanced = (await logOf(scene)).events.findLast(
        (event) => event.name === 'stage_advanced',
      );
      expect(advanced?.evidence).toMatchObject({ from: 'ship', to: 'validate' });
    },
  );
});

describe('GH-6 a recovery of a decision recorded before next falls back to the stages in force', () => {
  sceneIt(
    "takes the item to the stage after Ship by today's rows when the decision names no next",
    async (scene) => {
      await lostApproval(scene, true);
      await dropDecisionNext(scene.world.database.db, scene.itemId);
      await spareAfterShip(scene);
      scene.world.adapters.clock.advance(sixteenMinutes);
      expect(await recoverAs(scene, scene.ian)).toEqual({
        status: 'accepted',
        value: { items: [{ itemId: scene.itemId, outcome: 'succeeded' }] },
      });
      const advanced = (await logOf(scene)).events.findLast(
        (event) => event.name === 'stage_advanced',
      );
      expect(advanced?.evidence).toMatchObject({ from: 'ship', to: 'spare' });
    },
  );
});
