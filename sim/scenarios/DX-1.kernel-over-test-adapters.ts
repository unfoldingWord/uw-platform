import assert from 'node:assert/strict';
import { migrationTimestamps } from '@uw/db/journal';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'DX-1',
  title:
    'the kernel runs over the ten test adapters, and reads the sim clock and the embedded store',
  run: async (world) => {
    const before = await world.kernel.health();
    world.adapters.clock.advance(15 * 60 * 1000);
    const after = await world.kernel.health();
    assert.equal(before.now.toISOString(), '2026-10-01T09:00:00.000Z');
    assert.equal(after.now.getTime() - before.now.getTime(), 15 * 60 * 1000);
    assert.deepEqual(after.appliedMigrations, migrationTimestamps);
    return {
      events: [],
      state: {
        now: after.now,
        appliedMigrations: after.appliedMigrations.length,
        ports: Object.keys(world.adapters),
      },
    };
  },
});
