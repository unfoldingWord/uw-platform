import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createClient } from '@uw/db/client';
import { queueWatermarks } from '@uw/db/schema';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import { owns, postgresWatermarks, readWatermark } from './watermarks.ts';

const early = new Date('2026-10-01T12:00:00.000Z');
const late = new Date('2026-10-01T12:00:30.000Z');
const firstConsume = new Date('2026-10-01T12:01:00.000Z');
const secondConsume = new Date('2026-10-01T12:02:00.000Z');

describe.skipIf(!testServer)('FD-11 queue watermarks', () => {
  it('owns exactly the queue_watermarks table', () => {
    expect(owns).toEqual([getTableName(queueWatermarks)]);
  });

  it('keeps the later enqueue time and the latest consume time in one row', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        const watermarks = postgresWatermarks(db);
        await watermarks.record('ingest', late, firstConsume);
        await watermarks.record('ingest', early, secondConsume);
        expect(await readWatermark(db, 'ingest')).toEqual({
          lastEnqueuedAt: late,
          lastConsumedAt: secondConsume,
        });
        expect(await db.select().from(queueWatermarks)).toHaveLength(1);
      } finally {
        await db.$client.end();
      }
    }));

  it('reads nothing for a queue that has never been consumed', () =>
    withMigratedDatabase(testServer ?? '', async (target) => {
      const db = createClient(target);
      try {
        expect(await readWatermark(db, 'ingest')).toBeNull();
      } finally {
        await db.$client.end();
      }
    }));
});
