import { eq, sql } from 'drizzle-orm';
import type { Database, Executor } from '@uw/db/client';
import { queueWatermarks } from '@uw/db/schema';
import type { Watermarks } from './consumer.ts';

export const owns = ['queue_watermarks'] as const;

export type Watermark = { readonly lastEnqueuedAt: Date; readonly lastConsumedAt: Date };

export function postgresWatermarks(db: Database): Watermarks {
  return {
    record: async (queue, enqueuedAt, consumedAt) => {
      await db
        .insert(queueWatermarks)
        .values({ queue, lastEnqueuedAt: enqueuedAt, lastConsumedAt: consumedAt })
        .onConflictDoUpdate({
          target: queueWatermarks.queue,
          set: {
            lastEnqueuedAt: sql`greatest(${queueWatermarks.lastEnqueuedAt}, excluded.last_enqueued_at)`,
            lastConsumedAt: sql`excluded.last_consumed_at`,
          },
        });
    },
  };
}

export async function readWatermark(db: Executor, queue: string): Promise<Watermark | null> {
  const [row] = await db
    .select()
    .from(queueWatermarks)
    .where(eq(queueWatermarks.queue, queue))
    .limit(1);
  if (!row) return null;
  return { lastEnqueuedAt: row.lastEnqueuedAt, lastConsumedAt: row.lastConsumedAt };
}
