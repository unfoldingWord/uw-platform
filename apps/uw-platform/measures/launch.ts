import type { ErrorReason, MeasureRunState } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { claimSlot, finishRun, runById, waitingRuns } from './runs.ts';
import { MEASURE_RUN_SLOTS, type MeasureRunBinding } from './sandbox.ts';

export type RunStarter = {
  readonly binding: MeasureRunBinding | null;
  readonly traceId: string;
};

export type Refused = { readonly ok: false; readonly reason: ErrorReason };

export type Launched =
  { readonly ok: true; readonly runId: string; readonly state: MeasureRunState } | Refused;

export type Queued = { readonly ok: true; readonly runId: string } | Refused;

export type Launch = 'launched' | 'waiting' | 'failed';

export const HOUR_MS = 3_600_000;

export function refused(reason: ErrorReason): Refused {
  return { ok: false, reason };
}

export async function launchRun(
  db: Database,
  binding: MeasureRunBinding,
  runId: string,
  traceId: string,
  at: Date,
): Promise<Launch> {
  if (!(await claimSlot(db, runId, MEASURE_RUN_SLOTS, at))) return 'waiting';
  try {
    await binding.create({ id: runId, params: { runId, traceId } });
    return 'launched';
  } catch {
    await finishRun(db, runId, 'failed', at);
    return 'failed';
  }
}

export async function launchWaiting(
  db: Database,
  starter: { readonly binding: MeasureRunBinding; readonly traceId: string },
  room: number,
  at: Date,
): Promise<number> {
  let launched = 0;
  for (const runId of await waitingRuns(db, room)) {
    const launch = await launchRun(db, starter.binding, runId, starter.traceId, at);
    if (launch === 'launched') launched += 1;
  }
  return launched;
}

export async function launched(
  db: Database,
  starter: RunStarter,
  queued: Queued,
  at: Date,
): Promise<Launched> {
  if (!queued.ok) return queued;
  if (starter.binding === null) return refused('not_wired');
  await launchRun(db, starter.binding, queued.runId, starter.traceId, at);
  const state = (await runById(db, queued.runId))?.state ?? 'queued';
  return { ok: true, runId: queued.runId, state };
}
