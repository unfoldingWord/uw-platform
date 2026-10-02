import assert from 'node:assert/strict';
import { seedPage } from '@uw/db/test-seed';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAdvance, simCaller, simIan, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

type Lane = {
  readonly world: World;
  readonly harnessId: string;
  readonly editor: Caller;
  readonly worker: Awaited<ReturnType<typeof simPerson>>;
};

async function itemAtScope(lane: Lane, title: string): Promise<string> {
  const { itemId } = valueOf(
    await lane.world.kernel.items.enqueue(lane.editor, {
      harnessId: lane.harnessId,
      title,
      pageId: null,
      priority: 1,
      due: null,
    }),
  );
  await simAdvance(lane.world, {
    harnessId: lane.harnessId,
    itemId,
    worker: lane.worker,
    through: ['package'],
  });
  valueOf(await lane.world.kernel.items.claim(lane.editor, { itemId, delegationId: null }));
  return itemId;
}

async function seedLearning(world: World, n: number, bodyMd: string): Promise<string> {
  const id = `00000000-0000-4000-8000-00000007${n.toString(10).padStart(4, '0')}`;
  await seedPage(world.database.db, {
    id,
    type: 'learning',
    status: 'suggested',
    jdArea: '80-89',
    bodyMd,
    slug: `learning-${n}`,
    title: `Learning ${n}`,
  });
  return id;
}

async function submitScope(lane: Lane, itemId: string) {
  return valueOf(
    await lane.world.kernel.items.submit(lane.editor, {
      itemId,
      to: null,
      evidence: {},
      change: null,
    }),
  );
}

export const scenario = defineScenario({
  id: 'KN-7',
  title:
    'an item leaves a validated stage with a labelled learning attached or a nothing_learned marker a person signed',
  run: async (world) => {
    const { harness } = await createSimHarness(world, software);
    valueOf(
      await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
        harnessId: harness.id,
        stageKey: 'scope',
        change: { validators: ['learning_attached'] },
      }),
    );
    const worker = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const lane: Lane = { world, harnessId: harness.id, editor: simCaller(world, worker), worker };
    const { items } = world.kernel;

    const a = await itemAtScope(lane, 'Wire the board');
    assert.equal((await submitScope(lane, a)).result, 'checks_failed');
    const labelled = await seedLearning(world, 1, '- [observed] the board loads in 300 ms');
    valueOf(await items.attachLearning(lane.editor, { itemId: a, pageId: labelled }));
    assert.equal((await submitScope(lane, a)).result, 'advanced');

    const b = await itemAtScope(lane, 'Speed the board');
    const bare = await seedLearning(world, 2, '- the board is faster');
    valueOf(await items.attachLearning(lane.editor, { itemId: b, pageId: bare }));
    const unlabelled = await submitScope(lane, b);
    assert.equal(unlabelled.result, 'checks_failed');
    assert.match(unlabelled.failures.join('\n'), /claim without an evidence label/);

    const c = await itemAtScope(lane, 'Bump a dependency');
    valueOf(
      await items.markNothingLearned(lane.editor, {
        itemId: c,
        reason: 'Routine dependency bump',
      }),
    );
    assert.equal((await submitScope(lane, c)).result, 'advanced');
    const events = await world.adapters.store.transaction((tx) => readAllEvents(tx, harness.id, c));
    const marker = events.find((event) => event.name === 'nothing_learned');
    assert.equal(marker?.actor, worker.identity);
    assert.equal(marker?.at, world.adapters.clock.now().toISOString());
    assert.deepEqual(marker?.evidence, { reason: 'Routine dependency bump' });
    return {
      state: {
        a: 'advanced',
        b: unlabelled.result,
        c: 'advanced',
        signedBy: marker?.actor ?? null,
      },
    };
  },
});
