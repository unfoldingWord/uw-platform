import { and, eq, sql } from 'drizzle-orm';
import { integer, pgSchema, text } from 'drizzle-orm/pg-core';
import { executorOf } from './store.ts';
import type { DrizzleTransaction } from './types.ts';

const pgLocks = pgSchema('pg_catalog').table('pg_locks', {
  locktype: text('locktype'),
  pid: integer('pid'),
});

export async function advisoryLocksHeld(tx: DrizzleTransaction): Promise<number> {
  const [row] = await executorOf(tx)
    .select({ held: sql<number>`count(*)::int` })
    .from(pgLocks)
    .where(and(eq(pgLocks.locktype, 'advisory'), eq(pgLocks.pid, sql`pg_backend_pid()`)));
  return row?.held ?? 0;
}
