import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simPerson } from '../fixtures.ts';
import { flowWorld } from '../views.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function positionsOf(world: World, harnessId: string): Promise<readonly number[]> {
  const page = await world.adapters.store.transaction((tx) =>
    tx.harnessEvents.read.page({ harnessId, itemId: null, after: 0, limit: 100 }),
  );
  return page.events.map((event) => event.position);
}

describe('the live cursor a screen starts from', () => {
  it('is the latest event position of a readable harness, and 0 for a hidden or missing one', async () => {
    const world = await createWorld();
    try {
      const scene = await flowWorld(world);
      const positions = await positionsOf(world, scene.harnessId);
      const reader = simCaller(world, scene.editor);
      const input = { harnessId: scene.harnessId };
      expect(await world.kernel.views.cursor(reader, input)).toBe(Math.max(...positions));
      const stranger = simCaller(world, await simPerson(world, 9, []));
      expect(await world.kernel.views.cursor(stranger, input)).toBe(0);
      const missing = { harnessId: '00000000-0000-4000-8000-00000000dead' };
      expect(await world.kernel.views.cursor(reader, missing)).toBe(0);
    } finally {
      await world.close();
    }
  });
});
