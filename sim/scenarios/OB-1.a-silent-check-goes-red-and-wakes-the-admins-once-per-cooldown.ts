import assert from 'node:assert/strict';
import { healthLink } from '@uw/contracts';
import { software } from '@uw/harness';
import { createSimHarness, simAdvance, simCaller, simSystem } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import { personOf, recipientIds } from '../wakes.ts';

const minute = 60_000;

export const scenario = defineScenario({
  id: 'OB-1',
  title:
    'an item waiting in Check with no review step turns the harness amber at 45 minutes and red at 90; the red alarm wakes the area admins once per cooldown (not at exactly 10 minutes, again at 11) with a link to its drill-through',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    world.adapters.notifier.subscribe(personOf(admin));
    const caller = simCaller(world, admin);
    const { itemId } = value(
      await world.kernel.items.enqueue(caller, {
        harnessId: harness.id,
        title: 'Wait for a review',
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      }),
    );
    await simAdvance(world, {
      harnessId: harness.id,
      itemId,
      worker: admin,
      through: ['package', 'scope', 'plan', 'build'],
    });
    const system = simCaller(world, simSystem());
    const levels: string[] = [];
    const sounded: number[] = [];
    for (const minutes of [46, 45, 1, 9, 1]) {
      world.adapters.clock.advance(minutes * minute);
      const silences = await world.kernel.views.silence();
      levels.push(
        silences.find((silence) => silence.harness.id === harness.id)?.level ?? 'missing',
      );
      sounded.push(
        value(await world.kernel.alarms.soundSilence(system, { limit: 10 })).sounded.length,
      );
    }
    assert.deepEqual(levels, ['amber', 'red', 'red', 'red', 'red']);
    assert.deepEqual(sounded, [0, 1, 0, 0, 1]);
    const wakes = world.adapters.notifier
      .delivered()
      .filter((wake) => wake.reason === 'silence_alarm')
      .map((wake) => ({ to: recipientIds(wake), link: wake.link, itemId: wake.itemId }));
    const wake = { to: [personOf(admin)], link: healthLink('silence_alarm'), itemId: null };
    assert.deepEqual(wakes, [wake, wake]);
    return { state: { levels, sounded, wakes } };
  },
});
