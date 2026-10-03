import { delegatedIdentity, principalSchema, type Principal } from '@uw/contracts';
import { closeEmbeddedTemplate } from '@uw/db/embedded';
import type { Caller } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { readSpend, simAgent, simCaller, simPerson, simSystem } from '../fixtures.ts';
import { readWorldLog } from '../runner/log.ts';
import {
  itemEvents,
  itemInScope,
  itemOf,
  reasonOf,
  runOf,
  runWorld,
  startOn,
  value,
  watchingRuns,
  type RunsCalls,
  type RunWorld,
} from '../runs.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

type Watched = RunWorld & { readonly calls: RunsCalls };

const minute = 60_000;

async function inWorld(work: (scene: Watched) => Promise<void>): Promise<void> {
  const base = await createWorld();
  try {
    const { world, calls } = watchingRuns(base);
    await work({ ...(await runWorld(world)), calls });
    expect((await readWorldLog(base.adapters.store)).drift).toEqual([]);
  } finally {
    await base.close();
  }
}

async function laptopOf(scene: RunWorld, n: number): Promise<Caller> {
  const owner = await simPerson(scene.world, n, [
    { role: 'editor', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const device = simAgent(owner, `${owner.personId ?? ''}/laptop`, { interactive: true });
  return simCaller(scene.world, device);
}

function stepAs(scene: RunWorld, caller: Caller, runId: string, itemId = scene.itemId) {
  return scene.world.kernel.items.recordRunStep(caller, {
    itemId,
    runId,
    step: 'work',
    tokensIn: 900,
    tokensOut: 300,
    costBasis: 'subscription',
  });
}

async function claimedRun(scene: RunWorld, caller: Caller, itemId = scene.itemId) {
  value(await scene.world.kernel.items.claim(caller, { itemId, delegationId: null }));
  const runId = scene.world.adapters.ids.next();
  value(await stepAs(scene, caller, runId, itemId));
  return runId;
}

async function countOf(scene: RunWorld, itemId = scene.itemId): Promise<number> {
  return (await itemEvents(scene, itemId)).length;
}

async function eventsSince(scene: RunWorld, count: number, itemId = scene.itemId) {
  return (await itemEvents(scene, itemId)).slice(count);
}

function sweep(scene: RunWorld) {
  return scene.world.kernel.items.expireLeases(simCaller(scene.world, simSystem()), { limit: 10 });
}

async function submitCompletes(scene: Watched): Promise<void> {
  const laptop = await laptopOf(scene, 6);
  const runId = await claimedRun(scene, laptop);
  const before = await countOf(scene);
  const submitted = value(
    await scene.world.kernel.items.submit(laptop, {
      itemId: scene.itemId,
      to: null,
      evidence: {},
      change: null,
    }),
  );
  expect(submitted.result).toBe('advanced');
  expect(await runOf(scene.world, runId)).toMatchObject({
    outcome: 'completed',
    runShape: 'external-run',
    costBasis: 'subscription',
    costMinor: null,
    gates: ['scope'],
  });
  const after = await eventsSince(scene, before);
  const completed = after.find((event) => event.name === 'run_completed');
  expect(completed?.evidence).toEqual({
    runId,
    result: 'submitted',
    gates: ['scope'],
    review: null,
  });
  expect(completed?.actor).toBe(laptop.actor.identity);
  expect(after.filter((event) => event.name.startsWith('run_'))).toHaveLength(1);
}

async function releaseStops(scene: Watched): Promise<void> {
  const laptop = await laptopOf(scene, 6);
  const runId = await claimedRun(scene, laptop);
  const before = await countOf(scene);
  value(
    await scene.world.kernel.items.release(laptop, { itemId: scene.itemId, delegationId: null }),
  );
  const after = await eventsSince(scene, before);
  expect(after.map((event) => event.name)).toEqual(['item_released', 'run_stopped']);
  expect(after[1]?.evidence).toEqual({ runId, why: 'released' });
  expect(await runOf(scene.world, runId)).toMatchObject({ outcome: 'stopped' });
  expect((await runOf(scene.world, runId))?.endedAt).not.toBeNull();
  expect(scene.calls.stop).toEqual([]);
  const again = await claimedRun(scene, laptop);
  expect((await runOf(scene.world, again))?.outcome).toBe('running');
}

async function lapsedBySweep(scene: Watched, laptop: Caller): Promise<void> {
  const runId = await claimedRun(scene, laptop);
  const lapsedAt = (await itemOf(scene.world, scene.itemId))?.leaseExpiresAt;
  scene.world.adapters.clock.advance(16 * minute);
  const before = await countOf(scene);
  expect(value(await sweep(scene)).expired).toEqual([scene.itemId]);
  expect(value(await sweep(scene)).expired).toEqual([]);
  const after = await eventsSince(scene, before);
  expect(after.map((event) => event.name)).toEqual(['lease_expired', 'run_stopped']);
  expect(after[0]?.evidence).toEqual({ holder: laptop.actor.identity, leaseExpiresAt: lapsedAt });
  expect(after[1]?.evidence).toEqual({ runId, why: 'lease_expired' });
  expect((await runOf(scene.world, runId))?.outcome).toBe('stopped');
}

async function lapsedByClaim(scene: Watched, laptop: Caller): Promise<void> {
  const itemId = await itemInScope(scene, 'Expire on the next claim');
  const runId = await claimedRun(scene, laptop, itemId);
  scene.world.adapters.clock.advance(16 * minute);
  const before = await countOf(scene, itemId);
  const other = await laptopOf(scene, 7);
  value(await scene.world.kernel.items.claim(other, { itemId, delegationId: null }));
  const names = (await eventsSince(scene, before, itemId)).map((event) => event.name);
  expect(names).toEqual(['lease_expired', 'run_stopped', 'item_claimed']);
  expect((await runOf(scene.world, runId))?.outcome).toBe('stopped');
  expect(value(await sweep(scene)).expired).toEqual([]);
  expect((await eventsSince(scene, before, itemId)).length).toBe(names.length);
}

async function lapsedLeaseStops(scene: Watched): Promise<void> {
  const laptop = await laptopOf(scene, 6);
  await lapsedBySweep(scene, laptop);
  await lapsedByClaim(scene, laptop);
  expect(scene.calls.stop).toEqual([]);
}

async function noCheckpoint(scene: Watched): Promise<void> {
  const laptop = await laptopOf(scene, 6);
  const runId = await claimedRun(scene, laptop);
  scene.world.adapters.clock.advance(16 * minute);
  value(await sweep(scene));
  const before = await countOf(scene);
  expect(reasonOf(await stepAs(scene, laptop, runId))).toBe('not_holder');
  expect(await countOf(scene)).toBe(before);
  expect((await runOf(scene.world, runId))?.steps).toHaveLength(1);
}

async function hostedLapse(scene: Watched): Promise<void> {
  const { runId } = value(await startOn(scene));
  scene.world.adapters.clock.advance(16 * minute);
  const before = await countOf(scene);
  expect(value(await sweep(scene)).expired).toEqual([scene.itemId]);
  const names = (await eventsSince(scene, before)).map((event) => event.name);
  expect(names).toEqual(['lease_expired', 'run_stopped']);
  expect((await runOf(scene.world, runId))?.outcome).toBe('stopped');
  expect(scene.calls.stop).toEqual([runId]);
  await readSpend(scene.world);
  value(await startOn(scene));
}

function routineOf(scene: RunWorld): Caller {
  const identity = delegatedIdentity(
    `agent:${scene.owner.personId ?? ''}/routine`,
    'builder',
    scene.delegationId,
  );
  const actor: Principal = principalSchema.parse({
    identity,
    kind: 'agent',
    personId: scene.owner.personId,
    email: null,
    grants: scene.owner.grants,
    interactive: false,
  });
  return simCaller(scene.world, actor);
}

async function delegationLapse(scene: Watched): Promise<void> {
  const routine = routineOf(scene);
  const { claim } = scene.world.kernel.items;
  value(await claim(routine, { itemId: scene.itemId, delegationId: scene.delegationId }));
  const runId = scene.world.adapters.ids.next();
  value(await stepAs(scene, routine, runId));
  value(
    await scene.world.kernel.delegations.revoke(simCaller(scene.world, scene.owner), {
      delegationId: scene.delegationId,
    }),
  );
  const before = await countOf(scene);
  expect(reasonOf(await stepAs(scene, routine, runId))).toBe('delegation_lapsed');
  const after = await eventsSince(scene, before);
  expect(after.map((event) => event.name)).toEqual(['run_stopped', 'item_released']);
  expect(after[0]?.evidence).toEqual({ runId, why: 'delegation_lapsed' });
  expect((await runOf(scene.world, runId))?.outcome).toBe('stopped');
  expect((await itemOf(scene.world, scene.itemId))?.holder).toBeNull();
  expect(reasonOf(await stepAs(scene, routine, runId))).toBe('not_holder');
  expect(await countOf(scene)).toBe(before + after.length);
}

describe('an external run ends with its submit, release or lapsed lease', () => {
  it("HE-6 the holder's submit completes the external run submitted", () =>
    inWorld(submitCompletes));

  it('HE-6 release stops the external run released', () => inWorld(releaseStops));

  it('HE-6 a lapsed lease, expired by the sweep or by the next claim, stops the external run lease_expired once', () =>
    inWorld(lapsedLeaseStops));

  it("HE-6 the platform keeps no checkpoint: an expired external run's next step is not_holder", () =>
    inWorld(noCheckpoint));

  it('a hosted run whose lease lapsed is stopped by the sweep and its Workflow is stopped', () =>
    inWorld(hostedLapse));

  it('an external run whose delegation lapsed mid-step stops and frees its item', () =>
    inWorld(delegationLapse));
});
