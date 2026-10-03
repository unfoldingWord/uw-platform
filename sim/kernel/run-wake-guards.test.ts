import type { HarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { createKernel, type Runs, type Store } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller, simSeenHead } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  beatOf,
  gateWorld,
  itemEvents,
  itemInScope,
  parkedRun,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  stepOn,
  systemCaller,
  value,
  watchingRuns,
  type RunsCalls,
  type RunWorld,
} from '../runs.ts';
import { createWorld, type World } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Watched = { readonly scene: RunWorld; readonly calls: RunsCalls };

type Make = (world: World) => Promise<RunWorld>;

const capMinor = 125_000;

async function inWorld(
  make: Make,
  work: (watched: Watched) => Promise<void>,
  change: (watched: () => Watched) => Partial<Runs> = () => ({}),
): Promise<void> {
  const base = await createWorld();
  let current: Watched | null = null;
  const watched = (): Watched => {
    if (current === null) throw new Error('the world is not ready');
    return current;
  };
  try {
    const { world, calls } = watchingRuns(base, change(watched));
    current = { scene: await make(world), calls };
    await work(current);
    expect((await readWorldLog(base.adapters.store)).drift).toEqual([]);
  } finally {
    await base.close();
  }
}

async function checkAt(scene: RunWorld, percent: number): Promise<void> {
  scene.world.adapters.modelEngine.setSpend({
    spentMinor: (capMinor * percent) / 100,
    currency: 'USD',
  });
  const since = new Date('2026-10-01T00:00:00.000Z');
  const caller = systemCaller(scene);
  value(await scene.world.kernel.breaker.check(caller, { capMinor, currency: 'USD', since }));
}

function laneOf(scene: RunWorld, stageKey: string) {
  const caller = simCaller(scene.world, scene.admin);
  const input = { harnessId: scene.harnessId, stageKey };
  return {
    pause: () => scene.world.kernel.stages.pause(caller, input),
    resume: () => scene.world.kernel.stages.resume(caller, input),
  };
}

async function runLog(scene: RunWorld, itemId = scene.itemId): Promise<readonly HarnessEvent[]> {
  return (await itemEvents(scene, itemId)).filter((event) => event.name.startsWith('run_'));
}

async function heldForBreaker(scene: RunWorld, runId: string, calls: RunsCalls): Promise<void> {
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'hibernated',
    hibernatedFor: 'breaker',
  });
  const last = (await runLog(scene)).at(-1);
  expect(last).toMatchObject({ name: 'run_hibernated', evidence: { runId, why: 'breaker' } });
  expect(calls.resume).toEqual([]);
}

async function wokenOnce(scene: RunWorld, runId: string, calls: RunsCalls): Promise<void> {
  await checkAt(scene, 10);
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'running',
    hibernatedFor: null,
  });
  const resumed = (await runLog(scene)).filter((event) => event.name === 'run_resumed');
  expect(resumed.map((event) => event.evidence)).toEqual([{ runId, why: 'breaker' }]);
  expect(calls.resume).toEqual([runId]);
}

async function laneResumeWhilePausing({ scene, calls }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const lane = laneOf(scene, 'scope');
  value(await lane.pause());
  await checkAt(scene, 95);
  value(await lane.resume());
  await heldForBreaker(scene, runId, calls);
  await wokenOnce(scene, runId, calls);
}

async function decisionWhilePausing({ scene, calls }: Watched): Promise<void> {
  const parked = await parkedRun(scene);
  value(await scene.world.kernel.runs.hibernateAtGate(systemCaller(scene), parked.runId));
  await checkAt(scene, 95);
  const decided = await scene.world.kernel.gates.decide(simCaller(scene.world, scene.admin), {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
  expect(decided.status).toBe('accepted');
  await heldForBreaker(scene, parked.runId, calls);
  await wokenOnce(scene, parked.runId, calls);
}

async function decisionOnPausedHarness({ scene, calls }: Watched): Promise<void> {
  const parked = await parkedRun(scene);
  value(await scene.world.kernel.runs.hibernateAtGate(systemCaller(scene), parked.runId));
  const caller = simCaller(scene.world, scene.admin);
  const harness = { harnessId: scene.harnessId, stageKey: null };
  value(await scene.world.kernel.stages.pause(caller, harness));
  const decided = await scene.world.kernel.gates.decide(caller, {
    itemId: scene.itemId,
    decision: 'approve',
    reason: null,
    findings: [],
    seenHead: await simSeenHead(scene.world, scene.itemId),
  });
  expect(decided.status).toBe('accepted');
  expect(await runOf(scene.world, parked.runId)).toMatchObject({
    outcome: 'hibernated',
    hibernatedFor: 'paused',
  });
  const last = (await runLog(scene)).at(-1);
  expect(last).toMatchObject({ name: 'run_hibernated', evidence: { why: 'paused' } });
  expect(calls.resume).toEqual([]);
  value(await scene.world.kernel.stages.resume(caller, harness));
  expect(await runOf(scene.world, parked.runId)).toMatchObject({ outcome: 'running' });
  const resumed = (await runLog(scene)).filter((event) => event.name === 'run_resumed');
  expect(resumed.map((event) => event.evidence)).toEqual([{ runId: parked.runId, why: 'paused' }]);
  expect(calls.resume).toEqual([parked.runId]);
}

async function lapsedHostedRun({ scene, calls }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(
    await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.owner), {
      delegationId: scene.delegationId,
    }),
  );
  expect(reasonOf(await stepOn(scene, beat, { runId, step: 'work' }))).toBe('delegation_lapsed');
  expect(await runOf(scene.world, runId)).toMatchObject({ outcome: 'stopped' });
  expect(calls.stop).toEqual([runId]);
}

async function pauseRacingResume({ scene }: Watched): Promise<void> {
  const first = value(await startOn(scene));
  const otherItem = await itemInScope(scene, 'A second item in the lane');
  const second = value(await startOn(scene, { itemId: otherItem }));
  value(await laneOf(scene, 'scope').pause());
  const runs = [first, second].sort((a, b) => a.runId.localeCompare(b.runId));
  for (const run of runs) {
    expect(await runOf(scene.world, run.runId)).toMatchObject({ outcome: 'running' });
  }
  const [early, late] = runs;
  const names = async (itemId: string | undefined) =>
    (await runLog(scene, itemId)).map((event) => event.name);
  expect(await names(early?.itemId)).toEqual(['run_started', 'run_hibernated', 'run_resumed']);
  expect(await names(late?.itemId)).toEqual(['run_started']);
}

function resumeOnFirstHibernate(watched: () => Watched): Partial<Runs> {
  let done = false;
  return {
    hibernate: async () => {
      if (done) return;
      done = true;
      const { scene } = watched();
      value(await laneOf(scene, 'scope').resume());
    },
  };
}

async function overlappingBeats(base: World): Promise<void> {
  let armed = false;
  let planted: () => Promise<void> = () => Promise.resolve();
  const store: Store = {
    ...base.adapters.store,
    transaction: async (work) => {
      const result = await base.adapters.store.transaction(work);
      if (armed) {
        armed = false;
        await planted();
      }
      return result;
    },
  };
  const world: World = { ...base, kernel: createKernel({ ...base.adapters, store }) };
  const scene = await runWorld(world);
  const other = await itemInScope(scene, 'An item the other beat takes');
  planted = async () => {
    value(await startOn(scene, { itemId: other }));
  };
  armed = true;
  const beaten = value(await world.kernel.runs.beat(systemCaller(scene), { limit: 10 }));
  expect(beaten.started).toEqual([]);
  expect(beaten.skipped).toEqual([{ delegationId: scene.delegationId, reason: 'lease_held' }]);
  const live = await world.adapters.store.transaction((tx) =>
    tx.harnessRuns.read.live(scene.harnessId),
  );
  expect(live.map((run) => run.itemId)).toEqual([other]);
}

describe('a hosted run wakes only when nothing still holds it', () => {
  it('HE-5 a lane resumed while the breaker is pausing leaves the run hibernated for the breaker until it opens', () =>
    inWorld(runWorld, laneResumeWhilePausing));

  it('HE-5 a gate decided while the breaker is pausing commits and leaves the run hibernated for the breaker until it opens', () =>
    inWorld(gateWorld, decisionWhilePausing));

  it('HE-1 a gate decided on a paused harness leaves the run hibernated for the pause until the harness resumes', () =>
    inWorld(gateWorld, decisionOnPausedHarness));

  it('a hosted run stopped for a lapsed delegation has its Workflow stopped', () =>
    inWorld(runWorld, lapsedHostedRun));

  it('a pause whose lane is resumed before a run is hibernated leaves that run running', () =>
    inWorld(runWorld, pauseRacingResume, resumeOnFirstHibernate));

  it('two overlapping beats start at most one run per persona', async () => {
    const base = await createWorld();
    try {
      await overlappingBeats(base);
      expect((await readWorldLog(base.adapters.store)).drift).toEqual([]);
    } finally {
      await base.close();
    }
  });
});
