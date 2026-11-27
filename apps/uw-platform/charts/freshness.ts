import type { Executor } from '@uw/db/client';
import { queueProgress, type QueueProgress } from '../health/indicators.ts';
import type { ChartStale } from './sources.ts';

const STALE_AFTER_MS = 300_000;

function staleness(progress: QueueProgress, at: Date): ChartStale | null {
  const oldest = progress.oldestUnconsumed;
  if (oldest === null || at.getTime() - oldest.getTime() <= STALE_AFTER_MS) return null;
  return { since: oldest, reason: 'source_behind' };
}

export async function harnessFreshness(db: Executor, at: Date): Promise<ChartStale | null> {
  try {
    return staleness(await queueProgress(db), at);
  } catch {
    return { since: at, reason: 'source_unreadable' };
  }
}
