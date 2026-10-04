import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { heads } from './cast.ts';
import { travelToShip } from './to-ship.ts';
import { itemOf } from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWorld<T>(work: (world: World) => Promise<T>): Promise<T> {
  const world = await createWorld();
  try {
    return await work(world);
  } finally {
    await world.close();
  }
}

describe('the end-to-end journey on the software template', () => {
  it('kickstarts an item, holds a wrong premise, survives a lapsed lease and parks at Ship on the declared head', () =>
    inWorld(async (world) => {
      const journey = await travelToShip(world);
      const item = await itemOf(world, journey.itemId);
      expect(item).toMatchObject({
        stageKey: 'ship',
        gateStatus: 'parked',
        expectedHead: heads.second,
        riskTier: 'standard',
        branchState: 'active',
      });
      const wrong = await itemOf(world, journey.wrongItemId);
      expect(wrong).toMatchObject({ stageKey: 'scope', holder: null, gateStatus: 'working' });
    }));
});
