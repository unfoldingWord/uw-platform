import { AsyncLocalStorage } from 'node:async_hooks';
import type { AnyDatabase } from '../any-database.ts';

class CallOutsideOpenTransactionError extends Error {
  readonly call: string;

  constructor(call: string) {
    super(
      `${call} was called from inside an open transaction on the same database; pass the transaction instead`,
    );
    this.name = 'CallOutsideOpenTransactionError';
    this.call = call;
  }
}

const openTransactions = new AsyncLocalStorage<ReadonlySet<AnyDatabase>>();

export function insideOpenTransaction<T>(db: AnyDatabase, work: () => Promise<T>): Promise<T> {
  const open = new Set(openTransactions.getStore());
  open.add(db);
  return openTransactions.run(open, work);
}

export async function outsideOpenTransaction<T>(
  db: AnyDatabase,
  call: string,
  work: () => Promise<T>,
): Promise<T> {
  if (openTransactions.getStore()?.has(db)) throw new CallOutsideOpenTransactionError(call);
  return work();
}
