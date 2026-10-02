import { describe, expect, it } from 'vitest';
import type { Store, StoreTransaction } from '../ports.ts';
import { race } from './store.ts';

function untouched<T extends object>(): T {
  return new Proxy<T>(Object.create(null), {});
}

const refusingTransaction: StoreTransaction = {
  lock: () => Promise.reject(new Error('lock refused')),
  harnesses: untouched(),
  harnessStages: untouched(),
  harnessItems: untouched(),
  pages: untouched(),
};

const lockRefused: Store = {
  transaction: (work) => work(refusingTransaction),
  appliedMigrations: async () => [],
};

describe('DX-3 the store contract race', () => {
  it('rejects at once when the first transaction fails before it holds the lock', async () => {
    await expect(race(lockRefused, async () => undefined)).rejects.toThrow('lock refused');
  }, 1_000);
});
