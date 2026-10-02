import assert from 'node:assert/strict';
import { software, type Caller, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simIan, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

function reasonOf(outcome: KernelOutcome<unknown>): string | null {
  return outcome.status === 'error' ? outcome.reason : null;
}

function itemIdOf(outcome: KernelOutcome<{ readonly itemId: string }>): string {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value.itemId;
}

export const scenario = defineScenario({
  id: 'KN-5',
  title:
    'the stage WIP limit counts people and agents alike, and a release frees the place for an agent',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
      harnessId: harness.id,
      stageKey: 'package',
      change: { agentPickup: 'allowed', wipLimit: 1 },
    });
    const owner = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const editor: Caller = simCaller(world, owner);
    const builder = simCaller(
      world,
      simAgent(owner, `${owner.personId}/builder`, { interactive: true }),
    );
    const enqueue = (title: string) =>
      world.kernel.items.enqueue(editor, {
        harnessId: harness.id,
        title,
        pageId: null,
        priority: 1,
        due: null,
        delegationId: null,
      });
    const first = itemIdOf(await enqueue('First'));
    const secondItem = itemIdOf(await enqueue('Second'));
    const held = await world.kernel.items.claim(editor, { itemId: first, delegationId: null });
    const blocked = await world.kernel.items.claim(builder, {
      itemId: secondItem,
      delegationId: null,
    });
    await world.kernel.items.release(editor, { itemId: first, delegationId: null });
    const freed = await world.kernel.items.claim(builder, {
      itemId: secondItem,
      delegationId: null,
    });
    assert.equal(held.status, 'accepted');
    assert.equal(reasonOf(blocked), 'wip_limit_reached');
    assert.equal(freed.status, 'accepted');
    return { state: { blocked: reasonOf(blocked), freed: freed.status } };
  },
});
