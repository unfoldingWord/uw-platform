import assert from 'node:assert/strict';
import type { Principal } from '@uw/contracts';
import { software, type Caller } from '@uw/harness';
import { enqueueEpicAs, epicOfFour } from '../epics.ts';
import { createSimHarness, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { reasonOf, value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

function device(world: World, owner: Principal, name: string): Caller {
  return simCaller(
    world,
    simAgent(owner, `${owner.personId ?? ''}/${name}`, { interactive: true }),
  );
}

function claimOf(world: World, caller: Caller, itemId: string | undefined) {
  return world.kernel.items.claim(caller, { itemId: itemId ?? '', delegationId: null });
}

export const scenario = defineScenario({
  id: 'EI-4',
  title:
    'an epic of four with one blocker chain under a WIP limit of two: two independent items are claimed at once, the third independent one waits for a place and the blocked one is never offered',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    value(
      await world.kernel.stages.updateStage(simCaller(world, admin), {
        harnessId: harness.id,
        stageKey: 'package',
        change: { agentPickup: 'allowed', wipLimit: 2 },
      }),
    );
    world.adapters.githubFacts.givenEpic(epicOfFour);
    const { items } = value(await enqueueEpicAs(world, admin, harness.id));
    const [first, second, third, fourth] = items.map((item) => item.itemId);
    const owner = await simPerson(world, 2, [
      { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
    ]);
    const [a, b, c] = ['builder-a', 'builder-b', 'builder-c'].map((name) =>
      device(world, owner, name),
    );
    if (a === undefined || b === undefined || c === undefined) throw new Error('no devices');
    const before = value(await world.kernel.reads.poll(a, { harnessId: harness.id, limit: 10 }));
    assert.deepEqual(
      before.map((item) => item.itemId),
      [first, second, third],
    );
    assert.equal((await claimOf(world, a, first)).status, 'accepted');
    assert.equal((await claimOf(world, b, second)).status, 'accepted');
    const full = await claimOf(world, c, third);
    assert.equal(reasonOf(full), 'wip_limit_reached');
    const blocked = await claimOf(world, c, fourth);
    assert.equal(reasonOf(blocked), 'not_permitted');
    const after = value(await world.kernel.reads.poll(c, { harnessId: harness.id, limit: 10 }));
    assert.equal(
      after.some((item) => item.itemId === fourth),
      false,
    );
    const held = await world.adapters.store.transaction((tx) =>
      tx.harnessItems.read.forHarness(harness.id),
    );
    const live = held.filter((item) => item.holder !== null).length;
    assert.equal(live, 2);
    return {
      state: {
        live,
        waiting: items.length - live,
        full: reasonOf(full),
        blocked: reasonOf(blocked),
      },
    };
  },
});
