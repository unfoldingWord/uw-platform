import type { GateDecision, HarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simPerson, simSeenHead } from '../fixtures.ts';
import {
  beatOf,
  detailOf,
  gateWorld,
  itemEvents,
  itemOf,
  parkedRun,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  systemCaller,
  value,
  watchingRuns,
  type ParkedRun,
  type RunsCalls,
  type RunWorld,
} from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Watched = { readonly scene: RunWorld; readonly calls: RunsCalls };

type Make = (world: World) => Promise<RunWorld>;

async function inWorld(make: Make, work: (watched: Watched) => Promise<void>): Promise<void> {
  const base = await createWorld();
  try {
    const { world, calls } = watchingRuns(base);
    await work({ scene: await make(world), calls });
  } finally {
    await base.close();
  }
}

function host(scene: RunWorld) {
  return { kernel: scene.world.kernel.runs, caller: systemCaller(scene) };
}

async function hibernated(scene: RunWorld): Promise<ParkedRun> {
  const parked = await parkedRun(scene);
  const { kernel, caller } = host(scene);
  value(await kernel.hibernateAtGate(caller, parked.runId));
  return parked;
}

async function decide(scene: ParkedRun, decision: GateDecision, findings: string[] = []) {
  return scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: scene.itemId,
    decision,
    reason: null,
    findings,
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
}

async function eventsSince(scene: RunWorld, count: number): Promise<readonly HarnessEvent[]> {
  return (await itemEvents(scene, scene.itemId)).slice(count);
}

async function countOf(scene: RunWorld): Promise<number> {
  return (await itemEvents(scene, scene.itemId)).length;
}

function names(events: readonly HarnessEvent[]): readonly string[] {
  return events.map((event) => event.name);
}

async function approveResumes({ scene, calls }: Watched): Promise<void> {
  const parked = await parkedRun(scene);
  const { kernel, caller } = host(scene);
  const before = await countOf(scene);
  const asleep = value(await kernel.hibernateAtGate(caller, parked.runId));
  expect(asleep).toMatchObject({ outcome: 'hibernated', hibernatedFor: 'gate' });
  const [slept] = await eventsSince(scene, before);
  const run = await runOf(scene.world, parked.runId);
  expect(slept).toMatchObject({
    name: 'run_hibernated',
    actor: 'agent:builder',
    traceId: run?.traceId,
    evidence: { runId: parked.runId, why: 'gate' },
  });
  const decided = await countOf(scene);
  expect((await decide(parked, 'approve')).status).toBe('accepted');
  const after = await eventsSince(scene, decided);
  expect(names(after).at(-1)).toBe('run_resumed');
  expect(after.at(-1)?.evidence).toEqual({ runId: parked.runId, why: 'gate' });
  expect(await runOf(scene.world, parked.runId)).toMatchObject({
    outcome: 'running',
    hibernatedFor: null,
  });
  expect(calls.resume).toEqual([parked.runId]);
}

async function refusedResumesNothing({ scene, calls }: Watched): Promise<void> {
  const parked = await hibernated(scene);
  const editor = await simPerson(scene.world, 5, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const before = await countOf(scene);
  const outcome = await scene.world.kernel.gates.decide(simCaller(scene.world, editor), {
    itemId: scene.itemId,
    decision: 'reject',
    reason: null,
    findings: ['not yet'],
  });
  expect(reasonOf(outcome)).toBe('not_permitted');
  const asAgent = await scene.world.kernel.gates.decide(parked.beat, {
    itemId: scene.itemId,
    decision: 'reject',
    reason: null,
    findings: [],
  });
  expect(reasonOf(asAgent)).toBe('gate_refused_to_agent');
  expect(names(await eventsSince(scene, before))).toEqual(['gate_refused_to_agent']);
  expect(await runOf(scene.world, parked.runId)).toMatchObject({
    outcome: 'hibernated',
    hibernatedFor: 'gate',
  });
  expect(calls.resume).toEqual([]);
}

async function closesDecided(scene: ParkedRun): Promise<void> {
  const { kernel, caller } = host(scene);
  const before = await countOf(scene);
  const done = value(
    await kernel.complete(caller, scene.runId, { result: 'decided', review: null }),
  );
  expect(done.outcome).toBe('completed');
  expect(done.endedAt).not.toBeNull();
  const after = await eventsSince(scene, before);
  expect(names(after)).toEqual(['run_completed']);
  expect(after[0]?.evidence).toEqual({
    runId: scene.runId,
    result: 'decided',
    gates: ['sign_off'],
    review: null,
  });
}

async function rejectResumes({ scene, calls }: Watched): Promise<void> {
  const parked = await parkedRun(scene);
  const { kernel, caller } = host(scene);
  const early = await kernel.complete(caller, parked.runId, { result: 'decided', review: null });
  expect(reasonOf(early)).toBe('not_permitted');
  expect(detailOf(early)).toEqual({ why: 'item_parked' });
  value(await kernel.hibernateAtGate(caller, parked.runId));
  value(await decide(parked, 'reject', ['the notes miss the migration']));
  expect((await runOf(scene.world, parked.runId))?.outcome).toBe('running');
  expect(calls.resume).toEqual([parked.runId]);
  await closesDecided(parked);
}

async function takeOverResumes({ scene, calls }: Watched): Promise<void> {
  const parked = await hibernated(scene);
  value(await decide(parked, 'take_over'));
  expect((await runOf(scene.world, parked.runId))?.outcome).toBe('running');
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBe(scene.admin.identity);
  expect(calls.resume).toEqual([parked.runId]);
  await closesDecided(parked);
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBe(scene.admin.identity);
}

async function unreachableWorkflow(base: World): Promise<void> {
  const tried: string[] = [];
  const { world } = watchingRuns(base, {
    resume: async (runId) => {
      tried.push(runId);
      throw new Error('the Workflow cannot be reached');
    },
  });
  const scene = await gateWorld(world);
  const parked = await hibernated(scene);
  expect((await decide(parked, 'reject', ['redo'])).status).toBe('accepted');
  expect(tried).toEqual([parked.runId]);
  expect((await runOf(scene.world, parked.runId))?.outcome).toBe('running');
}

async function failReleases({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const { kernel, caller } = host(scene);
  const before = await countOf(scene);
  const failed = value(
    await kernel.fail(caller, runId, { step: 'work', why: 'retries_exhausted', detail: 'Error' }),
  );
  expect(failed).toMatchObject({ outcome: 'failed', failure: 'retries_exhausted' });
  expect(failed.endedAt).not.toBeNull();
  const after = await eventsSince(scene, before);
  expect(names(after)).toEqual(['run_failed', 'item_released']);
  expect(after[0]?.evidence).toEqual({
    runId,
    step: 'work',
    why: 'retries_exhausted',
    detail: 'Error',
  });
  expect(after[1]?.evidence).toEqual({ holder: 'agent:builder' });
  expect(after.every((event) => event.actor === 'agent:builder')).toBe(true);
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
}

async function premiseHeld({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const { kernel, caller } = host(scene);
  const before = await countOf(scene);
  const reason = 'the issue was fixed by an earlier change';
  const held = value(await kernel.holdPremise(caller, runId, { reason }));
  expect(held.outcome).toBe('completed');
  const after = await eventsSince(scene, before);
  expect(names(after)).toEqual(['premise_held', 'item_released', 'run_completed']);
  expect(after[0]?.evidence).toEqual({ runId, reason });
  expect(after[2]?.evidence).toEqual({
    runId,
    result: 'premise_held',
    gates: [],
    review: null,
  });
  const item = await itemOf(scene.world, scene.itemId);
  expect(item?.holder).toBeNull();
  expect(item?.stageKey).toBe('scope');
  expect(item?.gateStatus).toBe('working');
}

async function completedIsFinal({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const { kernel, caller } = host(scene);
  value(await kernel.complete(caller, runId, { result: 'submitted', review: null }));
  const before = await countOf(scene);
  const attempts = [
    await kernel.complete(caller, runId, { result: 'submitted', review: null }),
    await kernel.fail(caller, runId, { step: null, why: 'turn_limit', detail: null }),
    await kernel.hibernateAtGate(caller, runId),
    await kernel.halt(caller, runId, 'gate_wait_expired'),
    await kernel.holdPremise(caller, runId, { reason: 'late' }),
  ];
  for (const attempt of attempts) {
    expect(reasonOf(attempt)).toBe('not_permitted');
    expect(detailOf(attempt)).toEqual({ why: 'run_completed' });
  }
  expect(await countOf(scene)).toBe(before);
  expect((await runOf(scene.world, runId))?.outcome).toBe('completed');
}

async function gatesMet({ scene }: Watched): Promise<void> {
  const parked = await parkedRun(scene);
  expect((await runOf(scene.world, parked.runId))?.gates).toEqual(['sign_off']);
  const { kernel, caller } = host(scene);
  value(await kernel.hibernateAtGate(caller, parked.runId));
  value(await decide(parked, 'reject', ['again']));
  await closesDecided(parked);
}

async function scopeGateMet({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  const submitted = await scene.world.kernel.items.submit(beat, {
    itemId: scene.itemId,
    to: null,
    evidence: {},
    change: null,
  });
  expect(value(submitted).result).toBe('advanced');
  expect((await runOf(scene.world, runId))?.gates).toEqual(['scope']);
}

async function notParked({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const { kernel, caller } = host(scene);
  const before = await countOf(scene);
  const outcome = await kernel.hibernateAtGate(caller, runId);
  expect(reasonOf(outcome)).toBe('not_permitted');
  expect(detailOf(outcome)).toEqual({ why: 'not_parked' });
  expect(await countOf(scene)).toBe(before);
  expect((await runOf(scene.world, runId))?.outcome).toBe('running');
}

async function onlyTheRunHost({ scene }: Watched): Promise<void> {
  const parked = await parkedRun(scene);
  const kernel = scene.world.kernel.runs;
  const before = await countOf(scene);
  for (const caller of [parked.beat, simCaller(scene.world, scene.admin)]) {
    const attempts = [
      await kernel.hibernateAtGate(caller, parked.runId),
      await kernel.complete(caller, parked.runId, { result: 'submitted', review: null }),
      await kernel.fail(caller, parked.runId, { step: null, why: 'turn_limit', detail: null }),
      await kernel.holdPremise(caller, parked.runId, { reason: 'nothing to do' }),
      await kernel.halt(caller, parked.runId, 'gate_wait_expired'),
    ];
    for (const attempt of attempts) {
      expect(reasonOf(attempt)).toBe('not_permitted');
      expect(detailOf(attempt)).toEqual({ actor: caller.actor.identity });
    }
  }
  expect(await countOf(scene)).toBe(before);
}

async function haltsHibernated({ scene }: Watched): Promise<void> {
  const parked = await hibernated(scene);
  const { kernel, caller } = host(scene);
  const before = await countOf(scene);
  const halted = value(await kernel.halt(caller, parked.runId, 'gate_wait_expired'));
  expect(halted).toMatchObject({ outcome: 'stopped', hibernatedFor: null });
  const after = await eventsSince(scene, before);
  expect(names(after)).toEqual(['run_stopped']);
  expect(after[0]?.evidence).toEqual({ runId: parked.runId, why: 'gate_wait_expired' });
  expect((await itemOf(scene.world, scene.itemId))?.gateStatus).toBe('parked');
}

async function malformedEnds({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const { kernel, caller } = host(scene);
  const before = await countOf(scene);
  const attempts = [
    await kernel.fail(caller, runId, { step: null, why: 'turn_limit', detail: 'two\nlines' }),
    await kernel.holdPremise(caller, runId, { reason: 'first\nsecond' }),
    await kernel.holdPremise(caller, runId, { reason: '   ' }),
  ];
  for (const attempt of attempts) expect(reasonOf(attempt)).toBe('malformed_command');
  expect(await countOf(scene)).toBe(before);
  expect((await runOf(scene.world, runId))?.outcome).toBe('running');
}

async function haltsLapsedLease({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const { kernel, caller } = host(scene);
  const lapsedAt = (await itemOf(scene.world, scene.itemId))?.leaseExpiresAt;
  scene.world.adapters.clock.advance(16 * 60_000);
  const before = await countOf(scene);
  value(await kernel.halt(caller, runId, 'lease_expired'));
  const after = await eventsSince(scene, before);
  expect(names(after)).toEqual(['lease_expired', 'run_stopped']);
  expect(after[0]?.evidence).toEqual({ holder: 'agent:builder', leaseExpiresAt: lapsedAt });
  expect(after[0]?.actor).toBe('agent:builder');
  expect(after[1]?.evidence).toEqual({ runId, why: 'lease_expired' });
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
}

function gateIt(title: string, work: (watched: Watched) => Promise<void>): void {
  it(title, () => inWorld(gateWorld, work));
}

function scopeIt(title: string, work: (watched: Watched) => Promise<void>): void {
  it(title, () => inWorld(runWorld, work));
}

describe('kernel.runs lifecycle', () => {
  gateIt(
    "HE-1 a run parked at a human gate hibernates and a person's approve resumes it",
    approveResumes,
  );

  gateIt('HE-1 a refused decision resumes nothing', refusedResumesNothing);

  gateIt(
    'HE-1 a reject and a take over resume the run too, and its close completes it decided',
    async (watched) => {
      await rejectResumes(watched);
      await inWorld(gateWorld, takeOverResumes);
    },
  );

  it('a decision commits and resumes the run row when its Workflow cannot be reached', async () => {
    const base = await createWorld();
    try {
      await unreachableWorkflow(base);
    } finally {
      await base.close();
    }
  });

  scopeIt('a run that fails releases its item', failReleases);

  scopeIt(
    'a held premise records premise_held, releases the item and leaves it in its stage',
    premiseHeld,
  );

  scopeIt('a completed run accepts no other transition', completedIsFinal);

  scopeIt('a halt for an expired lease records the lease expiry, not a release', haltsLapsedLease);

  gateIt('HE-1 the run records each gate it met', gatesMet);

  scopeIt('a submit at a checks gate is noted on the run', scopeGateMet);

  scopeIt('a run whose item is not parked is refused not_parked', notParked);

  gateIt('refuses every host member to any caller but the run host', onlyTheRunHost);

  gateIt('a halt stops a hibernated run and leaves its item parked', haltsHibernated);

  scopeIt(
    'a fail detail or a premise reason that is not one printable line is malformed',
    malformedEnds,
  );
});
