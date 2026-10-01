import { sql } from 'drizzle-orm';
import type { AnyDatabase, AnyExecutor } from '../any-database.ts';
import { appliedMigrations } from '../migration-ledger.ts';

export type DrizzleTransaction = { lock(key: string): Promise<void> };

export type DrizzleStore = {
  transaction<T>(work: (tx: DrizzleTransaction) => Promise<T>): Promise<T>;
  appliedMigrations(): Promise<readonly number[]>;
};

const executors = new WeakMap<DrizzleTransaction, AnyExecutor>();

export function executorOf(tx: DrizzleTransaction): AnyExecutor {
  const executor = executors.get(tx);
  if (!executor) throw new TypeError('not a transaction of the Drizzle store');
  return executor;
}

function bind(executor: AnyExecutor): DrizzleTransaction {
  const tx: DrizzleTransaction = {
    lock: async (key) => {
      await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    },
  };
  executors.set(tx, executor);
  return tx;
}

async function inTransaction<T>(
  db: AnyDatabase,
  work: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  const thrown: { failed: boolean; error: unknown } = { failed: false, error: undefined };
  try {
    return await db.transaction(async (executor) => {
      try {
        return await work(bind(executor));
      } catch (error) {
        thrown.failed = true;
        thrown.error = error;
        throw error;
      }
    });
  } catch (error) {
    throw thrown.failed ? thrown.error : error;
  }
}

export function createDrizzleStore(db: AnyDatabase): DrizzleStore {
  return {
    transaction: (work) => inTransaction(db, work),
    appliedMigrations: () => appliedMigrations(db),
  };
}
