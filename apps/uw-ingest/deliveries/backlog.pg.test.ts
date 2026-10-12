import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import { oldestDeliveryReceivedAfter } from './backlog.ts';

async function withDeliveries<T>(work: (db: Database) => Promise<T>): Promise<T> {
  return withMigratedDatabase(testServer ?? '', async (target) => {
    const db = createClient(target);
    try {
      return await work(db);
    } finally {
      await db.$client.end();
    }
  });
}

async function receivedAt(db: Database, deliveryId: string, iso: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO webhook_deliveries (source, delivery_id, received_at) VALUES ('github', ${deliveryId}, ${iso}::timestamptz)`,
  );
}

describe.skipIf(!testServer)('FD-11 the oldest delivery received after an instant', () => {
  it('is null when no delivery has been received', () =>
    withDeliveries(async (db) => {
      expect(await oldestDeliveryReceivedAfter(db, null)).toBeNull();
    }));

  it('is the oldest delivery overall when no instant is given', () =>
    withDeliveries(async (db) => {
      await receivedAt(db, 'b', '2026-10-01T12:00:05.000Z');
      await receivedAt(db, 'a', '2026-10-01T12:00:01.000Z');
      expect(await oldestDeliveryReceivedAfter(db, null)).toEqual(
        new Date('2026-10-01T12:00:01.000Z'),
      );
    }));

  it('is the oldest delivery strictly after the instant, or null when none is', () =>
    withDeliveries(async (db) => {
      await receivedAt(db, 'a', '2026-10-01T12:00:01.000Z');
      await receivedAt(db, 'b', '2026-10-01T12:00:05.000Z');
      await receivedAt(db, 'c', '2026-10-01T12:00:09.000Z');
      const after = new Date('2026-10-01T12:00:05.000Z');
      expect(await oldestDeliveryReceivedAfter(db, after)).toEqual(
        new Date('2026-10-01T12:00:09.000Z'),
      );
      const latest = new Date('2026-10-01T12:00:09.000Z');
      expect(await oldestDeliveryReceivedAfter(db, latest)).toBeNull();
    }));
});
