import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { seedGrantLostLapses, seedLapsedDelegations } from '@uw/db/test-seed';
import { FAILED_RUNS_LIMIT, VIEW_LIMIT, software, type RunRow } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { createSimHarness, simCaller, simPerson } from '../fixtures.ts';
import { itemInScope, runOf } from '../runs.ts';
import { waitingScene, type Waiting } from '../views.ts';
import { createWorld } from '../world.ts';

afterAll(closeEmbeddedTemplate);

async function inWaiting(work: (scene: Waiting) => Promise<void>): Promise<void> {
  const world = await createWorld();
  try {
    await work(await waitingScene(world));
  } finally {
    await world.close();
  }
}

async function failedRunsOn(
  scene: Waiting,
  count: number,
  delegationId: string | null,
): Promise<void> {
  const template = await runOf(scene.world, scene.failedRun);
  if (template === null) throw new Error('no failed run');
  const itemId = await itemInScope(scene, 'Fail often');
  const { ids, clock, store } = scene.world.adapters;
  const now = clock.now();
  const runs = Array.from({ length: count }, (): RunRow => {
    const id = ids.next();
    return { ...template, id, itemId, delegationId, traceId: id, startedAt: now, endedAt: now };
  });
  await store.transaction(async (tx) => {
    for (const run of runs) await tx.harnessRuns.write.insert(run);
  });
}

async function failedShown(scene: Waiting) {
  const waiting = await scene.world.kernel.views.waitingOn(simCaller(scene.world, scene.owner));
  const failed = waiting.rows.flatMap((row) => (row.kind === 'run_failed' ? [row.run.id] : []));
  return { failed, capped: waiting.failedRunsCapped };
}

async function ownOlderFailureShows(scene: Waiting): Promise<void> {
  await failedRunsOn(scene, 201, null);
  expect(await failedShown(scene)).toEqual({ failed: [scene.failedRun], capped: false });
}

async function capsAndSaysSo(scene: Waiting): Promise<void> {
  await failedRunsOn(scene, FAILED_RUNS_LIMIT + 1, scene.delegationId);
  const shown = await failedShown(scene);
  expect([shown.failed.length, shown.capped]).toEqual([FAILED_RUNS_LIMIT, true]);
  expect(shown.failed).not.toContain(scene.failedRun);
}

async function unreadableTakeNoSlot(scene: Waiting): Promise<void> {
  const template = await runOf(scene.world, scene.failedRun);
  if (template === null) throw new Error('no failed run');
  const viewer = await simPerson(scene.world, 7, [
    { role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' },
  ]);
  const elsewhere = await createSimHarness(scene.world, software, {
    key: 'elsewhere',
    jdArea: '20-29',
    repository: null,
  });
  const hiddenItem = await itemInScope(
    { world: scene.world, harnessId: elsewhere.harness.id, admin: scene.admin },
    'Fail out of sight',
  );
  const shownItem = await itemInScope(scene, 'Fail in sight');
  const { ids, clock, store } = scene.world.adapters;
  const now = clock.now();
  const device = `agent:${viewer.personId ?? ''}/laptop` as RunRow['persona'];
  const runOn = (harnessId: string, itemId: string, endedAt: Date): RunRow => {
    const id = ids.next();
    const base = { ...template, id, traceId: id, delegationId: null, persona: device };
    return { ...base, harnessId, itemId, startedAt: endedAt, endedAt };
  };
  const shown = runOn(scene.harnessId, shownItem, new Date(now.getTime() - 60_000));
  const hidden = Array.from({ length: FAILED_RUNS_LIMIT }, () =>
    runOn(elsewhere.harness.id, hiddenItem, now),
  );
  await store.transaction(async (tx) => {
    for (const run of [shown, ...hidden]) await tx.harnessRuns.write.insert(run);
  });
  const waiting = await scene.world.kernel.views.waitingOn(simCaller(scene.world, viewer));
  const failed = waiting.rows.flatMap((row) => (row.kind === 'run_failed' ? [row.run.id] : []));
  expect({ failed, capped: waiting.failedRunsCapped }).toEqual({
    failed: [shown.id],
    capped: false,
  });
}

async function lapsedCapSaysSo(scene: Waiting): Promise<void> {
  const caller = simCaller(scene.world, scene.owner);
  expect((await scene.world.kernel.views.waitingOn(caller)).lapsedCapped).toBe(false);
  const now = scene.world.adapters.clock.now();
  await seedLapsedDelegations(scene.world.database.db, {
    personId: scene.owner.personId ?? '',
    harnessId: scene.harnessId,
    persona: 'agent:scout',
    count: VIEW_LIMIT,
    lapsedAt: new Date(now.getTime() - 60_000),
  });
  expect((await scene.world.kernel.views.waitingOn(caller)).lapsedCapped).toBe(true);
}

async function orphanCapSaysSo(scene: Waiting): Promise<void> {
  const caller = simCaller(scene.world, scene.owner);
  expect((await scene.world.kernel.views.waitingOn(caller)).lapsedCapped).toBe(false);
  const elsewhere = await createSimHarness(scene.world, software, {
    key: 'elsewhere',
    jdArea: '20-29',
  });
  await seedGrantLostLapses(scene.world.database.db, {
    harnessId: elsewhere.harness.id,
    count: VIEW_LIMIT,
    at: new Date(scene.world.adapters.clock.now().getTime() - 60_000),
  });
  expect((await scene.world.kernel.views.waitingOn(caller)).lapsedCapped).toBe(true);
}

describe('failed runs on Home', () => {
  it('WB-9 a person still sees their own older failed run after more than 200 newer failures across the organisation', () =>
    inWaiting(ownOlderFailureShows));
  it('Home lists at most 50 failed runs and says the list is capped', () =>
    inWaiting(capsAndSaysSo));
  it('failed runs on a harness the person cannot read take no place in the 50', () =>
    inWaiting(unreadableTakeNoSlot));
  it('Home says it is capped when more delegations lapsed than the read takes', () =>
    inWaiting(lapsedCapSaysSo));
  it('Home says it is capped when lapses on other harnesses fill the read for other admins', () =>
    inWaiting(orphanCapSaysSo));
});
