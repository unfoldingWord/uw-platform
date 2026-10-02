import assert from 'node:assert/strict';
import { software } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'KN-5',
  title: 'an agent may not claim in a stage whose agent pickup is none, and a person may',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    const owner = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const editor = simCaller(world, owner);
    const builder = simCaller(world, simAgent(owner, 'builder', { interactive: true }));
    const enqueued = await world.kernel.items.enqueue(editor, {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    });
    assert.equal(enqueued.status, 'accepted');
    if (enqueued.status !== 'accepted') throw new Error('unreachable');
    const itemId = enqueued.value.itemId;
    const refused = await world.kernel.items.claim(builder, { itemId, delegationId: null });
    assert.equal(refused.status === 'error' && refused.reason, 'pickup_not_allowed');
    const taken = await world.kernel.items.claim(editor, { itemId, delegationId: null });
    assert.equal(taken.status, 'accepted');
    return { state: { agent: 'pickup_not_allowed', person: taken.status } };
  },
});
