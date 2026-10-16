import type { Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { rewriteRunDelegation } from '@uw/db/test-seed';
import type { Caller, RunRow, RunStepInput } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simAgent, simCaller, simPerson } from '../fixtures.ts';
import {
  beatOf,
  detailOf,
  itemEvents,
  itemInScope,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  value,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';
import { readWorldLog } from '../runner/log.ts';

afterAll(closeEmbeddedTemplate);

type Started = RunWorld & { readonly runId: string; readonly beat: Caller };

async function inStarted(work: (scene: Started) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    const scene = await runWorld(world);
    const { runId } = value(await startOn(scene));
    await work({ ...scene, runId, beat: await beatOf(scene) });
    expect((await readWorldLog(world.adapters.store)).drift).toEqual([]);
  } finally {
    await world.close();
  }
}

function startedIt(title: string, work: (scene: Started) => Promise<void>): void {
  it(title, () => inStarted(work));
}

function stepOf(itemId: string, runId: string, change: Partial<RunStepInput> = {}): RunStepInput {
  return {
    itemId,
    runId,
    step: 'work',
    tokensIn: 100,
    tokensOut: 20,
    costBasis: 'subscription',
    ...change,
  };
}

function metered(scene: Started, change: Partial<RunStepInput> = {}): RunStepInput {
  return stepOf(scene.itemId, scene.runId, { costBasis: 'metered', ...change });
}

function stepAs(scene: Started, caller: Caller, input: RunStepInput) {
  return scene.world.kernel.items.recordRunStep(caller, input);
}

function rewriteRun(scene: Started, runId: string, change: (run: RunRow) => RunRow) {
  return scene.world.adapters.store.transaction(async (tx) => {
    const run = await tx.harnessRuns.read.lock(runId);
    if (run === null) throw new Error(`no run ${runId}`);
    await tx.harnessRuns.write.update(change(run));
  });
}

function deviceOf(scene: Started, owner: Principal): Caller {
  return simCaller(scene.world, simAgent(owner, `${owner.personId}/laptop`, { interactive: true }));
}

async function heldBy(scene: Started, caller: Caller, title: string): Promise<string> {
  const itemId = await itemInScope(scene, title);
  value(await scene.world.kernel.items.claim(caller, { itemId, delegationId: null }));
  return itemId;
}

async function countOf(scene: Started, itemId: string): Promise<number> {
  return (await itemEvents(scene, itemId)).length;
}

async function newEvents(scene: Started, itemId: string, after: number) {
  return (await itemEvents(scene, itemId)).slice(after);
}

async function meteredStepSums(scene: Started): Promise<void> {
  await rewriteRun(scene, scene.runId, (run) => ({ ...run, prompts: ['Read the plan.'] }));
  const before = await countOf(scene, scene.itemId);
  const first = metered(scene, {
    step: 'read',
    costMinor: 12,
    computeMinor: 3,
    model: 'claude-sonnet-5',
    resolvedProvider: 'anthropic',
    toolsCalled: ['read_page'],
    writes: 1,
  });
  const answered = value(await stepAs(scene, scene.beat, first));
  expect(answered.prompts).toEqual(['Read the plan.']);
  const second = metered(scene, { costMinor: 5, computeMinor: 2, resolvedProvider: 'other' });
  expect(value(await stepAs(scene, scene.beat, second)).prompts).toEqual([]);
  const run = await runOf(scene.world, scene.runId);
  expect(run?.steps.map((step) => step.step)).toEqual(['read', 'work']);
  expect(run).toMatchObject({ costMinor: 17, computeMinor: 5, resolvedProvider: 'anthropic' });
  expect(run?.prompts).toEqual([]);
  const events = await newEvents(scene, scene.itemId, before);
  expect(events.map((event) => event.name)).toEqual(['run_step_recorded', 'run_step_recorded']);
  expect(events[0]?.evidence).toMatchObject({
    runId: scene.runId,
    step: 'read',
    costBasis: 'metered',
    costMinor: 12,
    computeMinor: 3,
    model: 'claude-sonnet-5',
    resolvedProvider: 'anthropic',
    toolsCalled: ['read_page'],
    writes: 1,
  });
}

async function meteredUnknownRun(scene: Started): Promise<void> {
  const before = await countOf(scene, scene.itemId);
  const unknown = scene.world.adapters.ids.next();
  const outcome = await stepAs(scene, scene.beat, metered(scene, { runId: unknown }));
  expect(reasonOf(outcome)).toBe('run_not_found');
  expect(detailOf(outcome)).toEqual({ runId: unknown });
  expect(await countOf(scene, scene.itemId)).toBe(before);
  expect(await runOf(scene.world, unknown)).toBeNull();
  expect((await runOf(scene.world, scene.runId))?.steps).toEqual([]);
}

async function refusesStepLimit(scene: Started): Promise<void> {
  const record = {
    step: 'work' as const,
    tokensIn: 1,
    tokensOut: 1,
    costMinor: 0,
    computeMinor: 0,
    model: null,
    resolvedProvider: null,
    toolsCalled: [],
    writes: 0,
    at: scene.world.adapters.clock.now().toISOString(),
  };
  await rewriteRun(scene, scene.runId, (run) => ({ ...run, steps: Array(200).fill(record) }));
  const before = await countOf(scene, scene.itemId);
  const outcome = await stepAs(scene, scene.beat, metered(scene));
  expect(reasonOf(outcome)).toBe('not_permitted');
  expect(detailOf(outcome)).toEqual({ why: 'run_step_limit' });
  expect(await countOf(scene, scene.itemId)).toBe(before);
  expect((await runOf(scene.world, scene.runId))?.steps).toHaveLength(200);
}

async function firstSubscriptionStep(scene: Started): Promise<void> {
  const laptop = deviceOf(scene, scene.owner);
  const itemId = await heldBy(scene, laptop, 'Build it on a laptop');
  const before = await countOf(scene, itemId);
  const runId = scene.world.adapters.ids.next();
  const reply = value(await stepAs(scene, laptop, stepOf(itemId, runId, { model: 'opus' })));
  expect(reply.prompts).toEqual([]);
  value(await stepAs(scene, laptop, stepOf(itemId, runId)));
  const run = await runOf(scene.world, runId);
  expect(run).toMatchObject({
    itemId,
    persona: laptop.actor.identity,
    personaPageId: null,
    delegationId: null,
    runShape: 'external-run',
    engine: 'external',
    model: 'opus',
    costBasis: 'subscription',
    costMinor: null,
    computeMinor: null,
    outcome: 'running',
  });
  expect(run?.steps).toHaveLength(2);
  const events = await newEvents(scene, itemId, before);
  expect(events.map((event) => event.name)).toEqual([
    'run_started',
    'run_step_recorded',
    'run_step_recorded',
  ]);
  expect(events[0]?.evidence).toEqual({
    runId,
    persona: laptop.actor.identity,
    runShape: 'external-run',
    engine: 'external',
    model: 'opus',
    delegationId: null,
  });
}

async function subscriptionWithCost(scene: Started): Promise<void> {
  const laptop = deviceOf(scene, scene.owner);
  const itemId = await heldBy(scene, laptop, 'Build it on a laptop');
  const before = await countOf(scene, itemId);
  for (const cost of [{ costMinor: 4 }, { computeMinor: 0 }]) {
    const runId = scene.world.adapters.ids.next();
    const outcome = await stepAs(scene, laptop, stepOf(itemId, runId, cost));
    expect(reasonOf(outcome)).toBe('malformed_command');
    expect(detailOf(outcome)).toEqual({ why: 'subscription_has_no_cost' });
    expect(await runOf(scene.world, runId)).toBeNull();
  }
  expect(await countOf(scene, itemId)).toBe(before);
}

async function runElsewhere(scene: Started): Promise<void> {
  const laptop = deviceOf(scene, scene.owner);
  const first = await heldBy(scene, laptop, 'First laptop item');
  const runId = scene.world.adapters.ids.next();
  value(await stepAs(scene, laptop, stepOf(first, runId)));
  const second = await heldBy(scene, laptop, 'Second laptop item');
  const editor = await simPerson(scene.world, 6, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const desk = deviceOf(scene, editor);
  value(await scene.world.kernel.items.release(laptop, { itemId: first, delegationId: null }));
  value(await scene.world.kernel.items.claim(desk, { itemId: first, delegationId: null }));
  const attempts: readonly [Caller, RunStepInput][] = [
    [laptop, stepOf(second, runId)],
    [laptop, stepOf(second, scene.runId)],
    [desk, stepOf(first, runId)],
    [desk, stepOf(first, scene.runId)],
  ];
  const counts = [await countOf(scene, first), await countOf(scene, second)];
  for (const [caller, input] of attempts) {
    const outcome = await stepAs(scene, caller, input);
    expect(reasonOf(outcome)).toBe('not_permitted');
    expect(detailOf(outcome)).toEqual({ why: 'run_elsewhere' });
  }
  expect([await countOf(scene, first), await countOf(scene, second)]).toEqual(counts);
  expect((await runOf(scene.world, runId))?.steps).toHaveLength(1);
  expect((await runOf(scene.world, scene.runId))?.steps).toEqual([]);
  const fresh = scene.world.adapters.ids.next();
  value(await stepAs(scene, desk, stepOf(first, fresh)));
  expect((await runOf(scene.world, fresh))?.persona).toBe(desk.actor.identity);
}

async function hostedRunOnLaptop(scene: Started): Promise<void> {
  scene.world.adapters.clock.advance(16 * 60_000);
  const laptop = deviceOf(scene, scene.owner);
  value(await scene.world.kernel.items.claim(laptop, { itemId: scene.itemId, delegationId: null }));
  const before = await countOf(scene, scene.itemId);
  const outcome = await stepAs(scene, laptop, stepOf(scene.itemId, scene.runId));
  expect(reasonOf(outcome)).toBe('not_permitted');
  expect(detailOf(outcome)).toEqual({ why: 'run_elsewhere' });
  expect(await countOf(scene, scene.itemId)).toBe(before);
  expect((await runOf(scene.world, scene.runId))?.steps).toEqual([]);
}

async function subscriptionOnHostedRun(scene: Started): Promise<void> {
  const before = await countOf(scene, scene.itemId);
  const outcome = await stepAs(scene, scene.beat, stepOf(scene.itemId, scene.runId));
  expect(reasonOf(outcome)).toBe('not_permitted');
  expect(detailOf(outcome)).toEqual({ why: 'run_elsewhere' });
  expect(await countOf(scene, scene.itemId)).toBe(before);
  expect((await runOf(scene.world, scene.runId))?.steps).toEqual([]);
}

async function anotherDelegation(scene: Started): Promise<void> {
  const granted = await scene.world.kernel.delegations.grant(simCaller(scene.world, scene.owner), {
    harnessId: scene.harnessId,
    persona: 'agent:reviewer',
    capability: 'build',
    maxTier: null,
    expiresAt: null,
    supersedes: null,
  });
  const delegationId = value(granted).id;
  await rewriteRunDelegation(scene.world.database.db, scene.runId, delegationId);
  const before = await countOf(scene, scene.itemId);
  const outcome = await stepAs(scene, scene.beat, metered(scene));
  expect(reasonOf(outcome)).toBe('not_permitted');
  expect(detailOf(outcome)).toEqual({ why: 'run_elsewhere' });
  expect(await countOf(scene, scene.itemId)).toBe(before);
  expect((await runOf(scene.world, scene.runId))?.steps).toEqual([]);
}

describe('record_run_step on a hosted run', () => {
  startedIt(
    'HE-1 a metered step appends to the run, sums cost and compute, and records run_step_recorded with them',
    meteredStepSums,
  );

  startedIt('HE-1 a metered step for an unknown run id is run_not_found', meteredUnknownRun);

  startedIt('HE-1 the 201st step is refused run_step_limit', refusesStepLimit);

  startedIt(
    "a laptop that claims the item after the hosted run's lease lapsed cannot step on the hosted run",
    hostedRunOnLaptop,
  );

  startedIt(
    'a subscription step on a metered run is refused run_elsewhere',
    subscriptionOnHostedRun,
  );

  startedIt(
    "a hosted run under another delegation than the item's is refused run_elsewhere",
    anotherDelegation,
  );
});

describe('record_run_step on an external run', () => {
  startedIt(
    'HE-6 the first subscription step for an unknown run id creates an external run with no cost',
    firstSubscriptionStep,
  );

  startedIt(
    'HE-6 a subscription step carrying a cost is malformed_command and records nothing',
    subscriptionWithCost,
  );

  startedIt(
    'HE-6 a run id of another item or another runner is not_permitted run_elsewhere',
    runElsewhere,
  );
});
