import type { HarnessEvent } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { Runs } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  beatOf,
  detailOf,
  gateWorld,
  itemEvents,
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

async function inWorld(
  make: Make,
  work: (watched: Watched) => Promise<void>,
  change: Partial<Runs> = {},
): Promise<void> {
  const base = await createWorld();
  try {
    const { world, calls } = watchingRuns(base, change);
    const scene = await make(world);
    await work({ scene, calls });
    expect((await readWorldLog(base.adapters.store)).drift).toEqual([]);
  } finally {
    await base.close();
  }
}

function pauseOf(scene: RunWorld) {
  const caller = simCaller(scene.world, scene.admin);
  const { stages } = scene.world.kernel;
  return {
    pause: (stageKey: string | null) =>
      stages.pause(caller, { harnessId: scene.harnessId, stageKey }),
    resume: (stageKey: string | null) =>
      stages.resume(caller, { harnessId: scene.harnessId, stageKey }),
  };
}

function runEvents(events: readonly HarnessEvent[]): readonly HarnessEvent[] {
  return events.filter((event) => event.name.startsWith('run_'));
}

async function runLog(scene: RunWorld): Promise<readonly HarnessEvent[]> {
  return runEvents(await itemEvents(scene, scene.itemId));
}

async function pausingHibernates({ scene, calls }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  value(await pauseOf(scene).pause('scope'));
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'hibernated',
    hibernatedFor: 'paused',
  });
  const [, slept] = await runLog(scene);
  expect(slept).toMatchObject({ name: 'run_hibernated', actor: 'agent:builder' });
  expect(slept?.evidence).toEqual({ runId, why: 'paused' });
  expect(calls.hibernate).toEqual([runId]);
  value(await pauseOf(scene).pause('scope'));
  expect(calls.hibernate).toEqual([runId]);
}

async function resumesWhenUnpaused({ scene, calls }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const { pause, resume } = pauseOf(scene);
  value(await pause('scope'));
  value(await pause(null));
  value(await resume('scope'));
  expect((await runOf(scene.world, runId))?.outcome).toBe('hibernated');
  expect(calls.resume).toEqual([]);
  value(await resume(null));
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'running',
    hibernatedFor: null,
  });
  const names = (await runLog(scene)).map((event) => event.name);
  expect(names).toEqual(['run_started', 'run_hibernated', 'run_resumed']);
  expect((await runLog(scene)).at(-1)?.evidence).toEqual({ runId, why: 'paused' });
  expect(calls.resume).toEqual([runId]);
}

async function gateRunStays({ scene, calls }: Watched): Promise<void> {
  const parked = await parkedRun(scene);
  value(await scene.world.kernel.runs.hibernateAtGate(systemCaller(scene), parked.runId));
  const { pause, resume } = pauseOf(scene);
  value(await pause('sign_off'));
  value(await resume('sign_off'));
  expect(await runOf(scene.world, parked.runId)).toMatchObject({
    outcome: 'hibernated',
    hibernatedFor: 'gate',
  });
  expect(calls.hibernate).toEqual([]);
  expect(calls.resume).toEqual([]);
}

async function renewWhilePaused({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  const beat = await beatOf(scene);
  value(await pauseOf(scene).pause('scope'));
  scene.world.adapters.clock.advance(60_000);
  const renewed = value(await scene.world.kernel.items.renewLease(beat, { itemId: scene.itemId }));
  expect(renewed.leaseWarning).toBe(false);
  const stepped = await stepOn(scene, beat, { runId, step: 'work' });
  expect(reasonOf(stepped)).toBe('not_permitted');
  expect(detailOf(stepped)).toEqual({ why: 'paused', stage: 'scope' });
}

async function throwingHibernate({ scene }: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  value(await pauseOf(scene).pause(null));
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'hibernated',
    hibernatedFor: 'paused',
  });
  expect((await runLog(scene)).map((event) => event.name)).toEqual([
    'run_started',
    'run_hibernated',
  ]);
}

const unreachable: Partial<Runs> = {
  hibernate: () => Promise.reject(new Error('the Workflow cannot be reached')),
};

describe('pause and resume hibernate hosted runs', () => {
  it('HE-1 pausing a lane hibernates the hosted runs on its items and asks the Runs port to hibernate each', () =>
    inWorld(runWorld, pausingHibernates));

  it('HE-1 resuming the lane resumes them, but not while the harness is still paused', () =>
    inWorld(runWorld, resumesWhenUnpaused));

  it('HE-1 a run hibernated for its gate is not resumed by a lane resume', () =>
    inWorld(gateWorld, gateRunStays));

  it('HE-1 lease renewal is accepted while paused and a run step is refused', () =>
    inWorld(runWorld, renewWhilePaused));

  it('HE-1 a Runs port that throws on hibernate leaves the run hibernated in the log', () =>
    inWorld(runWorld, throwingHibernate, unreachable));
});
