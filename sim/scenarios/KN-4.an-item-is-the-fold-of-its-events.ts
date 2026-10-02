import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simCaller, simIan, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'KN-4',
  title:
    'an enqueued item sits in Package, working and unheld, and equals the replay of its events',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    const input = {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    };
    const editor = simCaller(
      world,
      await simPerson(world, 2, [{ role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' }]),
    );
    const outcome = await world.kernel.items.enqueue(editor, input);
    assert.equal(outcome.status, 'accepted');
    if (outcome.status !== 'accepted') throw new Error('unreachable');
    const item = outcome.value;
    assert.equal(item.stageKey, 'package');
    assert.equal(item.gateStatus, 'working');
    assert.equal(item.holder, null);
    const read = await world.kernel.events.read(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      itemId: item.itemId,
      after: 0,
      limit: 100,
    });
    assert.equal(read.status, 'accepted');
    if (read.status !== 'accepted') throw new Error('unreachable');
    assert.deepEqual(world.kernel.replay(read.value.events), item);
    const viewer = simCaller(
      world,
      await simPerson(world, 3, [{ role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' }]),
    );
    const refused = await world.kernel.items.enqueue(viewer, input);
    assert.equal(refused.status === 'error' && refused.reason, 'not_permitted');
    return { state: { item } };
  },
});
