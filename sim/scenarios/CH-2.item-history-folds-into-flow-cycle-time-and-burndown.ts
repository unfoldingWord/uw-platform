import assert from 'node:assert/strict';
import { burndown, cumulativeFlow, cycleTimes, daysEnding } from '@uw/harness';
import { simAdvance, simCaller, simPerson } from '../fixtures.ts';
import { itemInScope, reasonOf, runWorld, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'CH-2',
  title:
    'item history folds from the event log into cumulative flow, cycle time and burndown, for a reader of the workflow only',
  run: async (world) => {
    const scene = await runWorld(world);
    const moving = await itemInScope(scene, 'Draw the flow');
    await simAdvance(world, {
      harnessId: scene.harnessId,
      itemId: moving,
      worker: scene.owner,
      through: ['first'],
    });
    const read = value(
      await world.kernel.views.itemHistory(simCaller(world, scene.owner), {
        harnessId: scene.harnessId,
      }),
    );
    const days = daysEnding(world.adapters.clock.now());
    const today = days.at(-1) ?? '';
    const flow = cumulativeFlow(read, days).filter((row) => row.day === today);
    const [first, second, third] = read.stages;
    const count = (stage: string | null | undefined) =>
      flow.find((row) => row.stage === stage)?.items;
    assert.deepEqual([count(first), count(second), count(third), count(null)], [0, 1, 1, 0]);
    assert.deepEqual(burndown(read.items, days).at(-1), { day: today, open: 2 });
    assert.deepEqual(cycleTimes(read.items, days).at(-1), {
      day: today,
      finished: 0,
      medianDays: null,
    });
    const stranger = await simPerson(world, 9, []);
    const refused = await world.kernel.views.itemHistory(simCaller(world, stranger), {
      harnessId: scene.harnessId,
    });
    assert.deepEqual(reasonOf(refused), 'harness_not_found');
    return { state: { items: read.items.length, unread: read.unread, today: flow } };
  },
});
