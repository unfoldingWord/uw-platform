import type { HealthIndicator, HealthReport, OverallStatus } from '@uw/contracts';
import type { DatabaseHandle } from '../database.ts';
import { commitOf, type Bindings } from '../env.ts';
import { INGEST_QUEUE_KEY } from '../queue/consumer.ts';
import { readWatermark } from '../queue/watermarks.ts';

const DATABASE_AMBER_MS = 500;
export const DATABASE_TIMEOUT_MS = 2000;
const QUEUE_AMBER_SECONDS = 60;
const QUEUE_RED_SECONDS = 300;

const MS_PER_SECOND = 1000;

function commitIndicator(commit: string): HealthIndicator {
  return { name: 'commit', status: 'ok', detail: commit };
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function databaseIndicator(
  handle: Pick<DatabaseHandle, 'ping'> | null,
  clock: () => number,
): Promise<HealthIndicator> {
  if (!handle)
    return { name: 'database', status: 'not_configured', detail: 'no Hyperdrive binding' };
  const started = clock();
  try {
    await withTimeout(handle.ping(), DATABASE_TIMEOUT_MS);
  } catch {
    return { name: 'database', status: 'red', detail: 'unreachable' };
  }
  const elapsed = clock() - started;
  const status = elapsed < DATABASE_AMBER_MS ? 'ok' : 'amber';
  return { name: 'database', status, detail: `reachable in ${elapsed} ms` };
}

function lagStatus(seconds: number): 'ok' | 'amber' | 'red' {
  if (seconds < QUEUE_AMBER_SECONDS) return 'ok';
  return seconds < QUEUE_RED_SECONDS ? 'amber' : 'red';
}

async function queueIndicator(
  env: Bindings,
  handle: DatabaseHandle | null,
): Promise<HealthIndicator> {
  if (!env.INGEST_DLQ || !handle) {
    return { name: 'queue', status: 'not_configured', detail: 'no queue binding' };
  }
  try {
    const watermark = await withTimeout(
      readWatermark(handle.db, INGEST_QUEUE_KEY),
      DATABASE_TIMEOUT_MS,
    );
    if (!watermark) return { name: 'queue', status: 'ok', detail: 'no messages consumed yet' };
    const lag = Math.max(
      0,
      Math.floor(
        (watermark.lastConsumedAt.getTime() - watermark.lastEnqueuedAt.getTime()) / MS_PER_SECOND,
      ),
    );
    return { name: 'queue', status: lagStatus(lag), detail: `consumer lag ${lag} s` };
  } catch {
    return { name: 'queue', status: 'red', detail: 'watermark unreadable' };
  }
}

export function overallStatus(indicators: readonly HealthIndicator[]): OverallStatus {
  if (indicators.some((indicator) => indicator.status === 'red')) return 'red';
  if (indicators.some((indicator) => indicator.status === 'amber')) return 'amber';
  return 'ok';
}

export async function healthReport(
  env: Bindings,
  handle: DatabaseHandle | null,
  clock: () => number,
): Promise<HealthReport> {
  const commit = commitOf(env);
  const [database, queue] = await Promise.all([
    databaseIndicator(handle, clock),
    queueIndicator(env, handle),
  ]);
  const indicators = [commitIndicator(commit), database, queue];
  return { status: overallStatus(indicators), commit, indicators };
}
