import assert from 'node:assert/strict';
import type { RunOutcome } from '@uw/contracts';
import type { RunRow } from '@uw/harness';
import { simCaller, simSeenHead } from '../fixtures.ts';
import {
  gateWorld,
  itemEvents,
  itemOf,
  parkedRun,
  runOf,
  systemCaller,
  value,
  type ParkedRun,
} from '../runs.ts';
import { defineScenario } from '../scenario.ts';
import type { World } from '../world.ts';

async function runNow(world: World, runId: string): Promise<RunRow> {
  const run = await runOf(world, runId);
  assert.ok(run, 'the run row is missing');
  return run;
}

async function expectOutcome(world: World, runId: string, outcome: RunOutcome): Promise<void> {
  assert.equal((await runNow(world, runId)).outcome, outcome);
}

async function rejected(world: World, parked: ParkedRun): Promise<void> {
  value(
    await world.kernel.gates.decide(simCaller(world, parked.admin), {
      itemId: parked.itemId,
      decision: 'reject',
      reason: null,
      findings: ['the notes miss the migration step'],
      seenHead: await simSeenHead(world, parked.itemId),
    }),
  );
}

async function stateOf(world: World, parked: ParkedRun) {
  const run = await runNow(world, parked.runId);
  const item = await itemOf(world, parked.itemId);
  assert.ok(item, 'the item is missing');
  return {
    run: {
      outcome: run.outcome,
      gates: run.gates,
      steps: run.steps.map((step) => step.step),
      costMinor: run.costMinor,
    },
    item: { stage: item.stageKey, gateStatus: item.gateStatus, holder: item.holder },
  };
}

export const scenario = defineScenario({
  id: 'HE-1',
  title:
    "a hosted run submits at a human gate, hibernates, resumes only on a person's decision, and completes decided",
  run: async (world) => {
    const parked = await parkedRun(await gateWorld(world));
    const host = systemCaller(parked);
    value(await world.kernel.runs.hibernateAtGate(host, parked.runId));
    await expectOutcome(world, parked.runId, 'hibernated');
    await rejected(world, parked);
    await expectOutcome(world, parked.runId, 'running');
    value(
      await world.kernel.runs.complete(host, parked.runId, { result: 'decided', review: null }),
    );
    const names = (await itemEvents(parked, parked.itemId)).map((event) => event.name);
    assert.deepEqual(names, [
      'item_created',
      'item_claimed',
      'run_started',
      'run_step_recorded',
      'run_step_recorded',
      'submitted_to_gate',
      'run_hibernated',
      'gate_rejected',
      'run_resumed',
      'run_completed',
    ]);
    const state = await stateOf(world, parked);
    assert.equal(state.run.outcome, 'completed');
    assert.deepEqual(state.run.gates, ['sign_off']);
    return { state };
  },
});
