import { advisoryLock, advisoryLockShared } from '../advisory-locks.ts';
import type { AnyDatabase, AnyExecutor } from '../any-database.ts';
import { appliedMigrations } from '../migration-ledger.ts';
import { bindDelegations } from './delegations.ts';
import { bindEvents } from './events.ts';
import { bindGateDecisions } from './gate-decisions.ts';
import { bindHarnesses } from './harnesses.ts';
import { bindItems } from './items.ts';
import { insideOpenTransaction, outsideOpenTransaction } from './open-transactions.ts';
import { bindMeasurements } from './measurements.ts';
import { bindPages } from './pages.ts';
import { bindPersonas } from './personas.ts';
import { bindRuns } from './runs.ts';
import { bindStages } from './stages.ts';
import type { DrizzleTransaction } from './types.ts';

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
      await executor.execute(advisoryLock(key));
    },
    lockShared: async (key) => {
      await executor.execute(advisoryLockShared(key));
    },
    harnesses: bindHarnesses(executor),
    harnessStages: bindStages(executor),
    harnessItems: bindItems(executor),
    harnessEvents: bindEvents(executor),
    harnessRuns: bindRuns(executor),
    gateDecisions: bindGateDecisions(executor),
    delegations: bindDelegations(executor),
    pages: bindPages(executor),
    personas: bindPersonas(executor),
    measurements: bindMeasurements(executor),
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
        return await insideOpenTransaction(db, () => work(bind(executor)));
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
    transaction: (work) =>
      outsideOpenTransaction(db, 'store.transaction', () => inTransaction(db, work)),
    appliedMigrations: () =>
      outsideOpenTransaction(db, 'store.appliedMigrations', () => appliedMigrations(db)),
  };
}
