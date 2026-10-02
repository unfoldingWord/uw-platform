import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { readAllEvents, software, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAdvance, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

type Cast = {
  readonly world: World;
  readonly harnessId: string;
  readonly itemId: string;
  readonly ian: Principal;
  readonly max: Principal;
};

async function parkedTweak(world: World): Promise<Cast> {
  const { harness, admin } = await createSimHarness(world, software);
  const max = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  valueOf(
    await world.kernel.stages.updateStage(simCaller(world, admin), {
      harnessId: harness.id,
      stageKey: 'scope',
      change: { feeds: ['package'] },
    }),
  );
  const { itemId } = valueOf(
    await world.kernel.items.enqueue(simCaller(world, max), {
      harnessId: harness.id,
      title: 'Rethink the board',
      pageId: null,
      priority: 1,
      due: null,
      delegationId: null,
    }),
  );
  await simAdvance(world, { harnessId: harness.id, itemId, worker: max, through: ['package'] });
  const builder = simCaller(world, simAgent(max, `${max.personId}/builder`, { interactive: true }));
  valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  const tweak = valueOf(
    await world.kernel.items.submit(builder, { itemId, to: 'package', evidence: {}, change: null }),
  );
  assert.equal(tweak.result, 'parked');
  assert.equal(tweak.item.gateTarget, 'package');
  return { world, harnessId: harness.id, itemId, ian: admin, max };
}

function approveAs(scene: Cast, person: Principal) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, person), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
  });
}

export const scenario = defineScenario({
  id: 'KN-8',
  title:
    'the occasional tweak to Package moves only on a recorded human gate decision: an editor cannot approve it, an admin can, and the loop edge is taken',
  run: async (world) => {
    const scene = await parkedTweak(world);
    const byEditor = await approveAs(scene, scene.max);
    assert.equal(byEditor.status === 'error' && byEditor.reason, 'not_permitted');
    const approved = valueOf(await approveAs(scene, scene.ian));
    assert.equal(approved.advanced, true);
    assert.equal(approved.item.stageKey, 'package');
    assert.equal(approved.item.gateStatus, 'working');
    assert.equal(approved.item.gateTarget, null);
    const recorded = await world.adapters.store.transaction(async (tx) => ({
      decisions: await tx.gateDecisions.read.forItem(scene.itemId),
      events: await readAllEvents(tx, scene.harnessId, scene.itemId),
    }));
    assert.deepEqual(
      recorded.decisions.map((row) => [row.decision, row.actor, row.evidence['gateTarget']]),
      [['approve', scene.ian.identity, 'package']],
    );
    const taken = recorded.events.filter((event) => event.name === 'loop_edge_taken');
    assert.deepEqual(
      taken.map((event) => event.evidence),
      [{ from: 'scope', to: 'package' }],
    );
    return { state: { stage: approved.item.stageKey, decisions: recorded.decisions.length } };
  },
});
