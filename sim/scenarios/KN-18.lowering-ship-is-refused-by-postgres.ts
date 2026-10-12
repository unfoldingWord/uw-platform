import assert from 'node:assert/strict';
import { readAllEvents, software } from '@uw/harness';
import { createSimHarness, simCaller } from '../fixtures.ts';
import { defineScenario } from '../scenario.ts';

export const scenario = defineScenario({
  id: 'KN-18',
  title:
    'lowering Ship to a checks exit is refused by the Postgres constraint, recorded as stage_edit_refused, and changes nothing',
  run: async (world) => {
    const { harness, admin } = await createSimHarness(world, software);
    const outcome = await world.kernel.stages.updateStage(simCaller(world, admin), {
      harnessId: harness.id,
      stageKey: 'ship',
      change: { exitGate: 'checks' },
    });
    assert.deepEqual(outcome, {
      status: 'error',
      reason: 'stage_edit_refused',
      detail: { code: '23514', constraint: 'harness_stages_effect_needs_human_gate' },
    });
    const { stored, events } = await world.adapters.store.transaction(async (tx) => ({
      stored: await tx.harnessStages.read.forHarness(harness.id),
      events: await readAllEvents(tx, harness.id, null),
    }));
    assert.equal(stored.find((stage) => stage.key === 'ship')?.exitGate, 'human_approval');
    const refusals = events.filter((event) => event.name === 'stage_edit_refused');
    assert.equal(refusals.length, 1);
    assert.equal(events.at(-1)?.name, 'stage_edit_refused');
    assert.deepEqual(refusals[0]?.evidence, {
      stage: 'ship',
      reason: 'stage_edit_refused',
      code: '23514',
      constraint: 'harness_stages_effect_needs_human_gate',
    });
    return { state: { ship: 'human_approval', refusals: refusals.length } };
  },
});
