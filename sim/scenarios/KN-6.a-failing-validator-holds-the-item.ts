import assert from 'node:assert/strict';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import {
  createSimHarness,
  simAdvance,
  simAgent,
  simCaller,
  simIan,
  simPerson,
} from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

export const scenario = defineScenario({
  id: 'KN-6',
  title:
    'a failing validator returns its failures, writes checks_failed and holds the item in its stage',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    valueOf(
      await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
        harnessId: harness.id,
        stageKey: 'scope',
        change: { validators: ['learning_attached'] },
      }),
    );
    const owner = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const editor = simCaller(world, owner);
    const builderPrincipal = simAgent(owner, `${owner.personId}/builder`, { interactive: true });
    const builder = simCaller(world, builderPrincipal);
    const { itemId } = valueOf(
      await world.kernel.items.enqueue(editor, {
        harnessId: harness.id,
        title: 'Wire the board',
        pageId: null,
        priority: 1,
        due: null,
      }),
    );
    const atScope = await simAdvance(world, {
      harnessId: harness.id,
      itemId,
      worker: owner,
      through: ['package'],
    });
    assert.equal(atScope.stageKey, 'scope');
    valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
    const submitted = valueOf(
      await world.kernel.items.submit(builder, { itemId, to: null, evidence: {}, change: null }),
    );
    assert.equal(submitted.result, 'checks_failed');
    assert.equal(submitted.failures.length, 1);
    assert.match(submitted.failures[0] ?? '', /^learning_attached:/);
    const events = await world.adapters.store.transaction((tx) =>
      readAllEvents(tx, harness.id, itemId),
    );
    const failed = events.filter((event) => event.name === 'checks_failed');
    assert.equal(failed.length, 1);
    assert.deepEqual(failed[0]?.evidence, { stage: 'scope', failures: submitted.failures });
    assert.equal(submitted.item.stageKey, 'scope');
    assert.equal(submitted.item.holder, builderPrincipal.identity);
    assert.equal(submitted.item.gateStatus, 'checks_failed');
    return { state: { stage: submitted.item.stageKey, gateStatus: submitted.item.gateStatus } };
  },
});
