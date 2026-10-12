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

type OpenToken = { open: boolean };

const openTransactions = new AsyncLocalStorage<ReadonlyMap<AnyDatabase, OpenToken>>();

export async function insideOpenTransaction<T>(
  db: AnyDatabase,
  work: () => Promise<T>,
): Promise<T> {
  const token: OpenToken = { open: true };
  const marked = new Map(openTransactions.getStore());
  marked.set(db, token);
  try {
    return await openTransactions.run(marked, work);
  } finally {
    token.open = false;
  }
}

export async function outsideOpenTransaction<T>(
  db: AnyDatabase,
  call: string,
  work: () => Promise<T>,
): Promise<T> {
  if (openTransactions.getStore()?.get(db)?.open) throw new CallOutsideOpenTransactionError(call);
  return work();
}
