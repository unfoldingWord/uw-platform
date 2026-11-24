import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { healthReportSchema, type HealthIndicator } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { postgresWatermarks } from '../queue/watermarks.ts';
import { recordingDeps } from '../testing/deps.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';

const MS = 1000;

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * MS);
}

async function consumedUpTo(db: Database, enqueuedSecondsAgo: number): Promise<void> {
  const enqueued = secondsAgo(enqueuedSecondsAgo);
  await postgresWatermarks(db).record('ingest', enqueued, new Date(enqueued.getTime() + MS));
}

async function received(db: Database, deliveryId: string, seconds: number): Promise<void> {
  await db.execute(
    sql`INSERT INTO webhook_deliveries (source, delivery_id, received_at) VALUES ('github', ${deliveryId}, ${secondsAgo(seconds).toISOString()}::timestamptz)`,
  );
}

async function queueIndicator(db: Database): Promise<HealthIndicator> {
  const { deps } = recordingDeps();
  const handle = { db, ping: async () => undefined, release: async () => undefined };
  const response = await createApp({ ...deps, openDatabase: () => handle }).request(
    '/health/probe',
    {},
    { INGEST_DLQ: { send: async () => undefined } },
  );
  const report = healthReportSchema.parse(await response.json());
  const found = report.indicators.find((indicator) => indicator.name === 'queue');
  if (!found) throw new Error('no queue indicator');
  return found;
}

describe.skipIf(!testServer)('FD-11 the queue indicator sees a consumer that stopped', () => {
  it('stays ok when every received delivery was consumed', () =>
    withAppDatabase(async (db) => {
      await received(db, 'a', 21);
      await consumedUpTo(db, 20);
      expect(await queueIndicator(db)).toEqual({
        name: 'queue',
        status: 'ok',
        detail: 'consumer lag 1 s',
      });
    }));

  it('turns amber when a delivery has waited over 60 s since the last consumed one', () =>
    withAppDatabase(async (db) => {
      await consumedUpTo(db, 600);
      await received(db, 'a', 120);
      const queue = await queueIndicator(db);
      expect(queue.status).toBe('amber');
      expect(queue.detail).toMatch(/^consumer lag 1 s, oldest unconsumed delivery 12\d s$/);
    }));

  it('turns red when a delivery has waited over 300 s', () =>
    withAppDatabase(async (db) => {
      await consumedUpTo(db, 900);
      await received(db, 'a', 400);
      await received(db, 'b', 30);
      const queue = await queueIndicator(db);
      expect(queue.status).toBe('red');
      expect(queue.detail).toMatch(/oldest unconsumed delivery 40\d s$/);
    }));

  it('turns red when deliveries arrived and nothing was ever consumed', () =>
    withAppDatabase(async (db) => {
      await received(db, 'a', 400);
      const queue = await queueIndicator(db);
      expect(queue.status).toBe('red');
      expect(queue.detail).toMatch(/^nothing consumed yet, oldest unconsumed delivery 40\d s$/);
    }));

  it('allows 30 s between a delivery being received and its enqueue time', () =>
    withAppDatabase(async (db) => {
      await consumedUpTo(db, 500);
      await received(db, 'a', 480);
      expect(await queueIndicator(db)).toMatchObject({ status: 'ok' });
    }));
});
