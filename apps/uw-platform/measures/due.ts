import type { Database, Transaction } from '@uw/db/client';
import {
  dueMeasures,
  lockedActivation,
  pauseActivation,
  restoreSchedule,
  scheduleNext,
} from './activations.ts';
import { HOUR_MS, launchRun, launchWaiting, type RunStarter } from './launch.ts';
import { measurePageOf } from './measure-pages.ts';
import { insertRun, openRunCount } from './runs.ts';
import { MEASURE_RUN_SLOTS, type MeasureRunBinding } from './sandbox.ts';
import { nextRunAfter } from './tool.ts';

export type Scheduler = RunStarter & { readonly identity: string };

type Bound = Scheduler & { readonly binding: MeasureRunBinding };

type ScheduledRun = { readonly runId: string; readonly slot: Date; readonly next: Date };

const LAUNCH_RETRY_MS = HOUR_MS;

async function queueScheduled(
  tx: Transaction,
  measureId: string,
  scheduler: Scheduler,
  at: Date,
): Promise<ScheduledRun | null> {
  const activation = await lockedActivation(tx, measureId);
  if (activation === null || activation.pausedReason !== null) return null;
  const slot = activation.nextRunAt;
  if (slot === null || slot.getTime() > at.getTime()) return null;
  const measure = await measurePageOf(tx, measureId);
  if (measure === null) return null;
  if (measure.status !== 'active' || measure.version !== activation.version) {
    await pauseActivation(tx, measureId, measure.status === 'retired' ? 'retired' : 'changed');
    return null;
  }
  const runId = crypto.randomUUID();
  await insertRun(tx, {
    id: runId,
    measurePageId: measureId,
    measureVersion: measure.version,
    toolHash: activation.toolHash,
    kind: 'scheduled',
    requestedBy: scheduler.identity,
    lock: activation.lock,
    lockSha256: activation.lockSha256,
    area: measure.jdArea,
    createdAt: at,
  });
  const next = nextRunAfter(measure.measure.schedule, at, measureId);
  await scheduleNext(tx, measureId, next);
  return { runId, slot, next };
}

async function startScheduled(
  db: Database,
  scheduler: Bound,
  measureId: string,
  at: Date,
): Promise<boolean> {
  const queued = await db.transaction((tx) => queueScheduled(tx, measureId, scheduler, at));
  if (queued === null) return false;
  const launch = await launchRun(db, scheduler.binding, queued.runId, scheduler.traceId, at);
  if (launch === 'failed' && at.getTime() - queued.slot.getTime() < LAUNCH_RETRY_MS) {
    await restoreSchedule(db, measureId, { from: queued.next, to: queued.slot });
  }
  return launch === 'launched';
}

export async function runDueMeasures(
  db: Database,
  scheduler: Scheduler,
  at: Date,
  limit: number,
): Promise<number> {
  const { binding } = scheduler;
  if (binding === null) return 0;
  const bound = { ...scheduler, binding };
  const room = Math.min(limit, MEASURE_RUN_SLOTS - (await openRunCount(db)));
  if (room <= 0) return 0;
  let started = await launchWaiting(db, bound, room, at);
  if (started >= room) return started;
  for (const measureId of await dueMeasures(db, at, room - started)) {
    if (await startScheduled(db, bound, measureId, at)) started += 1;
  }
  return started;
}
