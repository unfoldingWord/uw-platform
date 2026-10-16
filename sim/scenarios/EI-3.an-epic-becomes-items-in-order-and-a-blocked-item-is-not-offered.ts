import assert from 'node:assert/strict';
import { readAllEvents, software } from '@uw/harness';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'EI-3',
  title:
    'enqueue_epic turns an epic of four into four items in sub-issue order with the Blocked by line as a blocker, records epic_enqueued, makes no item for the epic, and poll_queue does not offer the blocked item',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    value(
      await world.kernel.stages.updateStage(simCaller(world, admin), {
        harnessId: harness.id,
        stageKey: 'package',
        change: { agentPickup: 'allowed' },
      }),
    );
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items, created } = value(await enqueueEpicAs(world, admin, harness.id));
    assert.equal(created, 4);
    assert.deepEqual(
      items.map((item) => item.issue?.number),
      [41, 42, 43, 44],
    );
    const [, , third, fourth] = items;
    assert.deepEqual(fourth?.blockedBy, [third?.itemId]);
    const owner = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const builder = simAgent(owner, `${owner.personId ?? ''}/builder`, { interactive: true });
    const polled = value(
      await world.kernel.reads.poll(simCaller(world, builder), {
        harnessId: harness.id,
        limit: 10,
      }),
    );
    assert.deepEqual(
      polled.map((item) => item.itemId),
      items.slice(0, 3).map((item) => item.itemId),
    );
    const events = await world.adapters.store.transaction((tx) =>
      readAllEvents(tx, harness.id, null),
    );
    const enqueued = events.filter((event) => event.name === 'epic_enqueued');
    assert.equal(enqueued.length, 1);
    return { state: { created, offered: polled.length } };
  },
});
