import assert from 'node:assert/strict';
import { readAllEvents, software, type Caller, type KernelOutcome } from '@uw/harness';
import { createSimHarness, simAgent, simCaller, simIan, simPerson } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

const minute = 60_000;

function valueOf<T>(outcome: KernelOutcome<T>): T {
  if (outcome.status !== 'accepted') throw new Error(`refused: ${outcome.reason}`);
  return outcome.value;
}

async function namesOf(world: World, harnessId: string, itemId: string): Promise<string[]> {
  const events = await world.adapters.store.transaction((tx) =>
    readAllEvents(tx, harnessId, itemId),
  );
  return events.map((event) => event.name);
}

type Setup = { readonly harnessId: string; readonly itemId: string; readonly builder: Caller };

async function setup(world: World): Promise<Setup> {
  const { harness } = await createSimHarness(world, software);
  await world.kernel.stages.updateStage(simCaller(world, await simIan(world)), {
    harnessId: harness.id,
    stageKey: 'package',
    change: { agentPickup: 'allowed' },
  });
  const owner = await simPerson(world, 2, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const builder = simCaller(
    world,
    simAgent(owner, `${owner.personId}/builder`, { interactive: true }),
  );
  const { itemId } = valueOf(
    await world.kernel.items.enqueue(simCaller(world, owner), {
      harnessId: harness.id,
      title: 'Wire the board',
      pageId: null,
      priority: 1,
      due: null,
    }),
  );
  valueOf(await world.kernel.items.claim(builder, { itemId, delegationId: null }));
  return { harnessId: harness.id, itemId, builder };
}

export const scenario = defineScenario({
  id: 'KN-5',
  title:
    'record_run_step renews the lease, warns when the lease it arrived on had three minutes or less, and a step on an expired lease is refused',
  run: async (world) => {
    const { harnessId, itemId, builder } = await setup(world);
    const start = world.adapters.clock.now().getTime();
    const at = (minutes: number) => new Date(start + minutes * minute).toISOString();
    const runId = world.adapters.ids.next();
    const step = () =>
      world.kernel.items.recordRunStep(builder, {
        itemId,
        runId,
        step: 'work',
        tokensIn: 1200,
        tokensOut: 300,
        costBasis: 'subscription',
      });
    world.adapters.clock.advance(13 * minute);
    const near = valueOf(await step());
    assert.deepEqual(near, { leaseExpiresAt: at(28), leaseWarning: true });
    world.adapters.clock.advance(5 * minute);
    const fresh = valueOf(await step());
    assert.deepEqual(fresh, { leaseExpiresAt: at(33), leaseWarning: false });
    world.adapters.clock.advance(32 * minute);
    const late = await step();
    assert.equal(late.status === 'error' && late.reason, 'lease_expired');
    const names = await namesOf(world, harnessId, itemId);
    assert.deepEqual(names, [
      'item_created',
      'item_claimed',
      'run_step_recorded',
      'run_step_recorded',
      'lease_expired',
    ]);
    return { state: { near, fresh, late: 'lease_expired' } };
  },
});
