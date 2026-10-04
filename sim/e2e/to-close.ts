import assert from 'node:assert/strict';
import type { HarnessEvent } from '@uw/contracts';
import { seedPage } from '@uw/db/test-seed';
import { simAgent, simCaller } from '../fixtures.ts';
import { harnessLog } from '../persona-fixtures.ts';
import {
  beatOf,
  itemOf,
  personaPrincipal,
  reasonOf,
  runOf,
  startOn,
  stepOn,
  value,
} from '../runs.ts';
import { itemLog, namesSince } from '../ship-fixtures.ts';
import { callerFor, freshSpend, host, hostedOn, pageIds, type Journey } from './cast.ts';

const noLearning =
  'learning_attached: the item carries no suggested learning or skill page and no nothing_learned marker';

const measurement = {
  source: 'web_analytics',
  name: 'board opens per day',
  value: 42,
  asOf: '2026-10-01',
} as const;

async function lastEvent(journey: Journey): Promise<HarnessEvent | undefined> {
  const { world, harnessId } = journey.cast;
  return (await itemLog(world, harnessId, journey.itemId)).events.at(-1);
}

async function measuredByAPerson(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const input = { itemId, ...measurement };
  value(await cast.world.kernel.measurements.record(callerFor(cast, cast.max), input));
}

async function iterateValidates(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const { world } = cast;
  await freshSpend(cast);
  await measuredByAPerson(journey);
  const scene = hostedOn(cast, cast.iterate, itemId);
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await stepOn(scene, beat, { runId, step: 'read' }));
  const read = value(await world.kernel.reads.measurements(beat, { itemId }));
  assert.deepEqual(
    read.map((row) => [row.name, row.value]),
    [[measurement.name, measurement.value]],
  );
  const moved = value(
    await world.kernel.items.submit(beat, { itemId, to: null, evidence: {}, change: null }),
  );
  assert.equal(moved.result, 'advanced');
  assert.deepEqual([moved.item.stageKey, moved.item.holder], ['close', null]);
  const run = value(
    await world.kernel.runs.complete(host(cast), runId, { result: 'submitted', review: null }),
  );
  assert.equal(run.outcome, 'completed');
}

async function closeRefused(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const { world } = cast;
  const max = callerFor(cast, cast.max);
  value(await world.kernel.items.claim(max, { itemId, delegationId: null }));
  const refused = value(
    await world.kernel.items.submit(max, { itemId, to: null, evidence: {}, change: null }),
  );
  assert.equal(refused.result, 'checks_failed');
  assert.deepEqual(refused.failures, [noLearning]);
  assert.equal(refused.item.stageKey, 'close');
  const last = await lastEvent(journey);
  assert.equal(last?.name, 'checks_failed');
  assert.deepEqual(last.evidence, { stage: 'close', failures: refused.failures });
  value(await world.kernel.items.release(max, { itemId, delegationId: null }));
}

async function iterateRefusedWithoutDelegation(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  await freshSpend(cast);
  const bare = simCaller(cast.world, simAgent(cast.kim, 'iterate', { interactive: false }));
  assert.equal(bare.actor.identity, cast.iterate.identity);
  const outcome = await cast.world.kernel.items.claim(bare, { itemId, delegationId: null });
  assert.equal(reasonOf(outcome), 'delegation_required');
  assert.equal((await lastEvent(journey))?.name, 'delegation_required');
}

async function iterateDraftsAndAttaches(journey: Journey): Promise<string> {
  const { cast, itemId } = journey;
  const { world } = cast;
  await freshSpend(cast);
  const scene = hostedOn(cast, cast.iterate, itemId);
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await stepOn(scene, beat, { runId, step: 'read' }));
  await seedPage(world.database.db, {
    id: pageIds.learning,
    type: 'learning',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'learning-board-first',
    title: 'People open the board first',
    bodyMd:
      '- [observed] people open the board before the gates\n- [inferred] the board is the first screen a person needs',
  });
  const attach = { itemId, pageId: pageIds.learning, delegationId: cast.iterate.delegationId };
  value(await world.kernel.items.attachLearning(beat, attach));
  return runId;
}

async function revokedAndStopped(journey: Journey, runId: string): Promise<void> {
  const { cast, itemId } = journey;
  const { world, harnessId } = cast;
  const delegationId = cast.iterate.delegationId;
  value(await world.kernel.delegations.revoke(callerFor(cast, cast.kim), { delegationId }));
  const before = await itemLog(world, harnessId, itemId);
  const stopped = await world.kernel.runs.scene(host(cast), runId);
  const after = await itemLog(world, harnessId, itemId);
  assert.equal(stopped.status, 'error');
  assert.equal(stopped.reason, 'delegation_lapsed');
  assert.equal(stopped.detail['why'], 'revoked');
  assert.deepEqual(namesSince(before, after), ['run_stopped', 'item_released']);
  const runStopped = after.events.find(
    (event) => event.name === 'run_stopped' && event.evidence['runId'] === runId,
  );
  assert.deepEqual(runStopped?.evidence, { runId, why: 'delegation_lapsed' });
  assert.equal((await runOf(world, runId))?.outcome, 'stopped');
  assert.equal((await itemOf(world, itemId))?.holder, null);
}

async function oneLapse(journey: Journey): Promise<number> {
  const { cast } = journey;
  const { world } = cast;
  const delegationId = cast.iterate.delegationId;
  const persona = simCaller(world, personaPrincipal(cast.kim, 'agent:iterate'));
  const again = await world.kernel.delegations.beat(persona, { delegationId });
  assert.equal(reasonOf(again), 'delegation_lapsed');
  const lapses = (await harnessLog(world, cast.harnessId)).filter(
    (event) => event.name === 'delegation_lapsed',
  );
  assert.equal(lapses.length, 1);
  assert.deepEqual(lapses[0]?.evidence, { delegationId, why: 'revoked' });
  return lapses.length;
}

async function closedWithLearning(journey: Journey): Promise<void> {
  const { cast, itemId } = journey;
  const { world } = cast;
  const max = callerFor(cast, cast.max);
  value(await world.kernel.items.claim(max, { itemId, delegationId: null }));
  const closed = value(
    await world.kernel.items.submit(max, { itemId, to: null, evidence: {}, change: null }),
  );
  assert.equal(closed.result, 'advanced');
  assert.deepEqual([closed.item.stageKey, closed.item.gateStatus], ['close', 'done']);
  const last = await lastEvent(journey);
  assert.equal(last?.name, 'stage_advanced');
  assert.deepEqual(last.evidence, { from: 'close', to: null });
}

export async function travelToClose(journey: Journey): Promise<{ readonly lapses: number }> {
  await iterateValidates(journey);
  await closeRefused(journey);
  await iterateRefusedWithoutDelegation(journey);
  const runId = await iterateDraftsAndAttaches(journey);
  await revokedAndStopped(journey, runId);
  const lapses = await oneLapse(journey);
  await closedWithLearning(journey);
  return { lapses };
}
