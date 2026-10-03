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
  harnessEvents: untouched(),
  harnessRuns: untouched(),
  gateDecisions: untouched(),
  delegations: untouched(),
  pages: untouched(),
};

const lockRefused: Store = {
  transaction: (work) => work(refusingTransaction),
  appliedMigrations: async () => [],
};

const lockingTransaction: StoreTransaction = {
  ...refusingTransaction,
  lock: async () => undefined,
};

const neverBlocks: Store = {
  transaction: (work) => work(lockingTransaction),
  appliedMigrations: async () => [],
};

describe('DX-3 the store contract race', () => {
  it('rejects at once when the first transaction fails before it holds the lock', async () => {
    await expect(race(lockRefused, undefined, async () => undefined)).rejects.toThrow(
      'lock refused',
    );
  }, 1_000);

  it('fails with the deadline message when the second transaction is never seen waiting', async () => {
    await expect(
      race(
        neverBlocks,
        async () => 0,
        () => Promise.reject(new Error('after the lock')),
      ),
    ).rejects.toThrow('never observed waiting');
  }, 10_000);
});
