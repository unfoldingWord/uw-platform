import { describe, expect, it } from 'vitest';
import type { Store } from '../ports.ts';
import { race } from './store.ts';

const lockRefused: Store = {
  transaction: (work) => work({ lock: () => Promise.reject(new Error('lock refused')) }),
  appliedMigrations: async () => [],
};

describe('DX-3 the store contract race', () => {
  it('rejects at once when the first transaction fails before it holds the lock', async () => {
    await expect(race(lockRefused, async () => undefined)).rejects.toThrow('lock refused');
  }, 1_000);
});
