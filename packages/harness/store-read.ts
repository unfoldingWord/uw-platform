import type { Store, StoreTransaction } from './ports.ts';

export function readOnly<T>(store: Store, work: (tx: StoreTransaction) => Promise<T>): Promise<T> {
  return store.read === undefined ? store.transaction(work) : store.read(work);
}
