import assert from 'node:assert/strict';
import { software, type Caller } from '@uw/harness';
import { createSimHarness, simAdvance, simAgent, simCaller, simPerson } from '../fixtures.ts';
import { value } from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

type Cast = { readonly harnessId: string; readonly itemId: string; readonly admin: Caller };

async function itemAtScope(world: World): Promise<Cast> {
  const { harness, admin } = await createSimHarness(world, software);
  const caller = simCaller(world, admin);
  const gated = {
    harnessId: harness.id,
    stageKey: 'scope',
    change: { exitGate: 'human_approval' as const },
  };
  value(await world.kernel.stages.updateStage(caller, gated));
  const enqueued = await world.kernel.items.enqueue(caller, {
    harnessId: harness.id,
    title: 'Write the run notes',
    pageId: null,
    priority: 1,
    due: null,
    delegationId: null,
  });
  const { itemId } = value(enqueued);
  await simAdvance(world, { harnessId: harness.id, itemId, worker: admin, through: ['package'] });
  return { harnessId: harness.id, itemId, admin: caller };
}

async function steppedAndSubmitted(world: World, cast: Cast): Promise<void> {
  const editor = await simPerson(world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const laptop = simCaller(
    world,
    simAgent(editor, `${editor.personId ?? ''}/laptop`, { interactive: true }),
  );
  const { itemId } = cast;
  value(await world.kernel.items.claim(laptop, { itemId, delegationId: null }));
  const step = { itemId, runId: world.adapters.ids.next(), step: 'work' as const };
  value(
    await world.kernel.items.recordRunStep(laptop, {
      ...step,
      tokensIn: 900,
      tokensOut: 300,
      costBasis: 'subscription',
    }),
  );
  const submitted = await world.kernel.items.submit(laptop, {
    itemId,
    to: null,
    evidence: {},
    change: null,
  });
  assert.equal(value(submitted).result, 'parked');
}

export const scenario = defineScenario({
  id: 'WB-8',
  title:
    "the play-by-play reads every event of an item in order through the one read route, each with its actor's full identity",
  run: async (world) => {
    const cast = await itemAtScope(world);
    await steppedAndSubmitted(world, cast);
    const rejected = await world.kernel.gates.decide(cast.admin, {
      itemId: cast.itemId,
      decision: 'reject',
      reason: null,
      findings: ['The notes skip the hibernation case'],
    });
    assert.equal(rejected.status, 'accepted');
    const input = { itemId: cast.itemId, after: 0 };
    const play = value(await world.kernel.views.playByPlay(cast.admin, input));
    assert.equal(play.next, null);
    return { state: { rows: play.events.map((event) => [event.name, event.actor]) } };
  },
});
