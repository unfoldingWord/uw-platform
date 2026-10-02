import { and, asc, eq, sql } from 'drizzle-orm';
import { boolean, integer, pgSchema, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { createClient } from './client.ts';
import { harnessA, insertEvent, seedHarness } from './event-log-fixtures.ts';
import { harnessEvents } from './schema.ts';
import { createMigratedDatabase, testServer } from './test-database.ts';

const pgLocks = pgSchema('pg_catalog').table('pg_locks', {
  locktype: text('locktype'),
  granted: boolean('granted'),
  database: integer('database'),
});

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function positions(db: AnyDatabase, harnessId: string): Promise<number[]> {
  const rows = await db
    .select({ position: harnessEvents.position })
    .from(harnessEvents)
    .where(eq(harnessEvents.harnessId, harnessId))
    .orderBy(asc(harnessEvents.position));
  return rows.map((row) => row.position);
}

async function advisoryLocksGranted(db: AnyDatabase): Promise<number> {
  const [row] = await db
    .select({ held: sql<number>`count(*)::int` })
    .from(pgLocks)
    .where(
      and(
        eq(pgLocks.locktype, 'advisory'),
        eq(pgLocks.granted, true),
        eq(pgLocks.database, sql`(SELECT oid FROM pg_database WHERE datname = current_database())`),
      ),
    );
  return row?.held ?? 0;
}

async function waitUntilLocked(db: AnyDatabase): Promise<void> {
  for (let waited = 0; waited < 2000; waited += 20) {
    if ((await advisoryLocksGranted(db)) > 0) return;
    await pause(20);
  }
  throw new Error('the first append never took its lock');
}

describe.skipIf(!testServer)(
  'KN-3 DX-6 positions become visible in order on two connections',
  () => {
    it('holds a second append behind the first until it commits, and never skips a position', async () => {
      const database = await createMigratedDatabase(testServer ?? '');
      const first = createClient(database.connectionString);
      const second = createClient(database.connectionString);
      try {
        await seedHarness(first, harnessA, 'software', '80-89');
        let releaseFirst: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        const firstDone = first.transaction(async (tx) => {
          await insertEvent(tx, harnessA, 1);
          await held;
        });
        await waitUntilLocked(second);
        const secondDone = second.transaction((tx) => insertEvent(tx, harnessA, 2));
        await pause(150);
        expect(await positions(second, harnessA)).toEqual([]);
        releaseFirst();
        await Promise.all([firstDone, secondDone]);
        expect(await positions(second, harnessA)).toEqual([1, 2]);
      } finally {
        await first.$client.end();
        await second.$client.end();
        await database.drop();
      }
    }, 30_000);
  },
);
