import { closeEmbeddedTemplate } from '@uw/db/embedded';
import { FAILED_RUNS_LIMIT, type RunRow } from '@uw/harness';
import { afterAll, describe, expect, it } from 'vitest';
import { simCaller } from '../fixtures.ts';
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

describe('failed runs on Home', () => {
  it('WB-9 a person still sees their own older failed run after more than 200 newer failures across the organisation', () =>
    inWaiting(ownOlderFailureShows));
  it('Home lists at most 50 failed runs and says the list is capped', () =>
    inWaiting(capsAndSaysSo));
});
