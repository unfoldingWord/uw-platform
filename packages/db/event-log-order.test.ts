import { and, asc, eq, sql } from 'drizzle-orm';
import { boolean, integer, pgSchema, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { createClient } from './client.ts';
import { harnessEvents } from './schema.ts';
import { seedEvent, seedHarness, seededEventId } from './test-seed.ts';
import { createMigratedDatabase, testServer } from './test-database.ts';

const pgLocks = pgSchema('pg_catalog').table('pg_locks', {
  locktype: text('locktype'),
  granted: boolean('granted'),
  database: integer('database'),
});

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const harnessA = '00000000-0000-4000-8000-0000000000b1';

async function positions(db: AnyDatabase, harnessId: string) {
  return db
    .select({ id: harnessEvents.id, position: harnessEvents.position })
    .from(harnessEvents)
    .where(eq(harnessEvents.harnessId, harnessId))
    .orderBy(asc(harnessEvents.position));
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

type Connections = { readonly first: AnyDatabase; readonly second: AnyDatabase };

async function withTwoConnections(work: (connections: Connections) => Promise<void>) {
  const database = await createMigratedDatabase(testServer ?? '');
  const first = createClient(database.connectionString);
  const second = createClient(database.connectionString);
  try {
    await seedHarness(first, { id: harnessA, key: 'software', jdArea: '80-89' });
    await work({ first, second });
  } finally {
    await first.$client.end();
    await second.$client.end();
    await database.drop();
  }
}

async function heldFirstAppend(first: AnyDatabase, second: AnyDatabase, fail: boolean) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstDone = first.transaction(async (tx) => {
    await seedEvent(tx, { harnessId: harnessA, n: 1 });
    await held;
    if (fail) throw new Error('the first append rolls back');
  });
  const firstSettled = firstDone.then(
    () => undefined,
    () => undefined,
  );
  await waitUntilLocked(second);
  const secondDone = second.transaction((tx) => seedEvent(tx, { harnessId: harnessA, n: 2 }));
  await pause(150);
  expect(await positions(second, harnessA)).toEqual([]);
  release();
  await Promise.all([firstSettled, secondDone]);
}

describe.skipIf(!testServer)(
  'KN-3 DX-6 positions become visible in order on two connections',
  () => {
    it('holds a second append behind the first until it commits, and never skips a position', async () => {
      await withTwoConnections(async ({ first, second }) => {
        await heldFirstAppend(first, second, false);
        expect(await positions(second, harnessA)).toEqual([
          { id: seededEventId(harnessA, 1), position: 1 },
          { id: seededEventId(harnessA, 2), position: 2 },
        ]);
      });
    }, 30_000);

    it('gives the second append position 1 when the first rolls back', async () => {
      await withTwoConnections(async ({ first, second }) => {
        await heldFirstAppend(first, second, true);
        expect(await positions(second, harnessA)).toEqual([
          { id: seededEventId(harnessA, 2), position: 1 },
        ]);
      });
    }, 30_000);
  },
);
