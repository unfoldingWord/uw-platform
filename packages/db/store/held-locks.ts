import { and, eq, inArray, sql } from 'drizzle-orm';
import { boolean, integer, pgSchema, text } from 'drizzle-orm/pg-core';
import type { AnyDatabase } from '../any-database.ts';
import { executorOf } from './store.ts';
import type { DrizzleTransaction } from './types.ts';

const pgLocks = pgSchema('pg_catalog').table('pg_locks', {
  locktype: text('locktype'),
  pid: integer('pid'),
  granted: boolean('granted'),
});

export async function advisoryLocksHeld(tx: DrizzleTransaction): Promise<number> {
  const [row] = await executorOf(tx)
    .select({ held: sql<number>`count(*)::int` })
    .from(pgLocks)
    .where(and(eq(pgLocks.locktype, 'advisory'), eq(pgLocks.pid, sql`pg_backend_pid()`)));
  return row?.held ?? 0;
}

const pgStatActivity = pgSchema('pg_catalog').table('pg_stat_activity', {
  pid: integer('pid'),
  datname: text('datname'),
});

export async function lockWaiters(db: AnyDatabase): Promise<number> {
  const [row] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(pgLocks)
    .where(
      and(
        eq(pgLocks.granted, false),
        inArray(pgLocks.locktype, ['advisory', 'transactionid', 'tuple']),
        inArray(
          pgLocks.pid,
          db
            .select({ pid: pgStatActivity.pid })
            .from(pgStatActivity)
            .where(eq(pgStatActivity.datname, sql`current_database()`)),
        ),
      ),
    );
  return row?.waiting ?? 0;
}
