import { asc } from 'drizzle-orm';
import { bigint, integer, pgSchema, text } from 'drizzle-orm/pg-core';
import type { AnyDatabase } from './any-database.ts';

const migrationLedger = pgSchema('drizzle').table('__drizzle_migrations', {
  id: integer('id').notNull(),
  hash: text('hash').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export async function appliedMigrations(db: AnyDatabase): Promise<number[]> {
  const rows = await db
    .select({ when: migrationLedger.createdAt })
    .from(migrationLedger)
    .orderBy(asc(migrationLedger.id));
  return rows.map((row) => row.when);
}
