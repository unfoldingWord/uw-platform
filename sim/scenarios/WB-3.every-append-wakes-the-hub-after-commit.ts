import assert from 'node:assert/strict';
import { readAllEvents, software } from '@uw/harness';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

const requestId = '00000000-0000-4000-8000-0000000000f3';
const area = { scopeKind: 'jd_area', scopeArea: '80-89' } as const;

export const scenario = defineScenario({
  id: 'WB-3',
  title:
    'every committed append wakes the harness hub, a refused command wakes nothing, and the event carries the requestId and trace id',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    assert.ok(world.adapters.hub.wakes().includes(harness.id));
    const input = {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    };
    const before = world.adapters.hub.wakes().length;
    const editor = simCaller(
      world,
      await simPerson(world, 2, [{ role: 'editor', ...area }]),
      requestId,
    );
    const outcome = await world.kernel.items.enqueue(editor, input);
    assert.equal(outcome.status, 'accepted');
    if (outcome.status !== 'accepted') throw new Error('unreachable');
    const afterEnqueue = world.adapters.hub.wakes();
    assert.deepEqual(afterEnqueue.slice(before), [harness.id]);
    const viewer = simCaller(world, await simPerson(world, 3, [{ role: 'viewer', ...area }]));
    const refused = await world.kernel.items.enqueue(viewer, input);
    assert.equal(refused.status === 'error' && refused.reason, 'not_permitted');
    assert.equal(world.adapters.hub.wakes().length, afterEnqueue.length);
    const events = await world.adapters.store.transaction((tx) =>
      readAllEvents(tx, harness.id, outcome.value.itemId),
    );
    const created = events.find((event) => event.name === 'item_created');
    assert.equal(created?.requestId, requestId);
    assert.equal(created?.traceId, editor.traceId);
    return { state: { wakes: world.adapters.hub.wakes().length } };
  },
});
