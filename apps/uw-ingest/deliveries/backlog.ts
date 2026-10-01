import { gt, min } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { webhookDeliveries } from '@uw/db/schema';

export async function oldestDeliveryReceivedAfter(
  db: Executor,
  after: Date | null,
): Promise<Date | null> {
  const [row] = await db
    .select({ oldest: min(webhookDeliveries.receivedAt) })
    .from(webhookDeliveries)
    .where(after === null ? undefined : gt(webhookDeliveries.receivedAt, after));
  return row?.oldest ?? null;
}
