import { describe, expect, it } from 'vitest';
import type { Grants, Hub, Store, StoreTransaction } from './ports.ts';
import { wakingGrants, wakingStore } from './hub-wakes.ts';

const at = new Date('2026-10-03T09:00:00.000Z');

function fakeTransaction(appendFor: readonly string[]): StoreTransaction {
  return {
    harnessEvents: {
      read: { page: async () => ({ events: [], next: null }) },
      write: {
        append: async () => appendFor.map((harnessId) => ({ harnessId })),
      },
    },
  } as unknown as StoreTransaction;
}

function fakeStore(tx: StoreTransaction, fail = false): Store {
  return {
    appliedMigrations: async () => [],
    transaction: async (work) => {
      const result = await work(tx);
      if (fail) throw new Error('rolled back');
      return result;
    },
  };
}

function storeAppending(appendFor: readonly string[], fail = false): Store {
  return fakeStore(fakeTransaction(appendFor), fail);
}

function recordingHub(failing = false): Hub & { readonly woken: string[] } {
  const woken: string[] = [];
  return {
    woken,
    wake: async (harnessId) => {
      woken.push(harnessId);
      if (failing) throw new Error('hub down');
    },
  };
}

function recordingGrants(): Grants & { readonly seen: StoreTransaction[] } {
  const seen: StoreTransaction[] = [];
  return {
    seen,
    resolve: async () => [],
    resolveIn: async (tx) => {
      seen.push(tx);
      return [];
    },
    lockAndReread: async (tx) => {
      seen.push(tx);
      return [];
    },
  };
}

describe('WB-3 the kernel wakes the hub after a committed append', () => {
  it('wakes each harness that got an event, once, after the transaction', async () => {
    const hub = recordingHub();
    const store = wakingStore(storeAppending(['h1', 'h1', 'h2']), hub);
    await store.transaction(async (tx) => {
      await tx.harnessEvents.write.append([]);
      expect(hub.woken).toEqual([]);
    });
    expect(hub.woken.sort()).toEqual(['h1', 'h2']);
  });

  it('wakes nothing when the transaction rolls back', async () => {
    const hub = recordingHub();
    const store = wakingStore(storeAppending(['h1'], true), hub);
    await expect(store.transaction((tx) => tx.harnessEvents.write.append([]))).rejects.toThrow();
    expect(hub.woken).toEqual([]);
  });

  it('wakes nothing for a transaction that appended nothing', async () => {
    const hub = recordingHub();
    await wakingStore(storeAppending([]), hub).transaction(async () => 1);
    expect(hub.woken).toEqual([]);
  });

  it('answers the command even when the hub fails', async () => {
    const hub = recordingHub(true);
    const store = wakingStore(storeAppending(['h1']), hub);
    const answer = store.transaction(async (tx) => {
      await tx.harnessEvents.write.append([]);
      return 'done';
    });
    await expect(answer).resolves.toBe('done');
    expect(hub.woken).toEqual(['h1']);
  });

  it('answers the command even when the hub throws before it returns a promise', async () => {
    const hub: Hub = {
      wake: () => {
        throw new Error('hub down');
      },
    };
    const store = wakingStore(storeAppending(['h1']), hub);
    const answer = store.transaction(async (tx) => {
      await tx.harnessEvents.write.append([]);
      return 'done';
    });
    await expect(answer).resolves.toBe('done');
  });
});

describe('grants read inside a waking transaction', () => {
  it('receive the store transaction itself, not the tracking one', async () => {
    const original = fakeTransaction(['h1']);
    const grants = recordingGrants();
    const store = wakingStore(fakeStore(original), recordingHub());
    const reading = wakingGrants(grants);
    await store.transaction(async (tx) => {
      expect(tx).not.toBe(original);
      await reading.resolveIn(tx, 'p1', at);
      await reading.lockAndReread(tx, 'p1', at);
    });
    expect(grants.seen).toEqual([original, original]);
    expect(grants.seen.every((tx) => tx === original)).toBe(true);
  });

  it('pass a transaction from outside the waking store through unchanged', async () => {
    const other = fakeTransaction([]);
    const grants = recordingGrants();
    await wakingGrants(grants).resolveIn(other, 'p1', at);
    expect(grants.seen[0]).toBe(other);
  });
});
