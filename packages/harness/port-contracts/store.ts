import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Store, StoreTransaction } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type StoreSubject = {
  readonly store: Store;
  readonly expectedMigrations: readonly number[];
  close(): Promise<void>;
};

async function takeTwice(tx: StoreTransaction): Promise<void> {
  await tx.lock('store-contract');
  await tx.lock('store-contract');
}

declare function setTimeout(handler: () => void, milliseconds: number): unknown;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function race(store: Store, firstWork: () => Promise<void>): Promise<string[]> {
  const order: string[] = [];
  let signal: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const first = store
    .transaction(async (tx) => {
      await tx.lock('store-contract-race');
      signal();
      await pause(150);
      await firstWork();
      order.push('first finished');
    })
    .catch(() => order.push('first failed'));
  await held;
  const second = store.transaction(async (tx) => {
    await tx.lock('store-contract-race');
    order.push('second locked');
  });
  await Promise.all([first, second]);
  return order;
}

function describeExclusion(subject: () => StoreSubject): void {
  it('holds a second transaction on a lock until the first commits', async () => {
    expect(await race(subject().store, async () => undefined)).toEqual([
      'first finished',
      'second locked',
    ]);
  });

  it('releases a lock when the transaction that held it throws', async () => {
    const order = await race(subject().store, () => Promise.reject(new Error('after the lock')));
    expect(order).toEqual(['first failed', 'second locked']);
  });

  it('DX-3 does not nest transactions: the work gets only lock, so pass the transaction along', async () => {
    const members = await subject().store.transaction(async (tx) => Object.keys(tx));
    expect(members).toEqual(['lock']);
  });
}

export function describeStoreContract(adapter: string, open: () => Promise<StoreSubject>): void {
  describe(`DX-3 store port contract on ${adapter}`, () => {
    let subject: StoreSubject;
    beforeAll(async () => {
      subject = await open();
    });
    afterAll(() => subject.close());

    it('reports every migration in the journal as applied, in order', async () => {
      expect(await subject.store.appliedMigrations()).toEqual(subject.expectedMigrations);
    });

    it('returns what the work returns', async () => {
      expect(await subject.store.transaction(async () => 42)).toBe(42);
    });

    it('rejects with the very error the work threw', async () => {
      const failure = new Error('work failed');
      await expect(subject.store.transaction(() => Promise.reject(failure))).rejects.toBe(failure);
    });

    it('lets one transaction take a lock twice and a later one take it again', async () => {
      await subject.store.transaction(takeTwice);
      await expect(subject.store.transaction(takeTwice)).resolves.toBeUndefined();
    });

    describeExclusion(() => subject);
  });
}

export function describeStoreNotWired(adapter: string, store: Store): void {
  describeNotWired('store', adapter, store, {
    transaction: true,
    appliedMigrations: true,
  } satisfies Record<keyof Store, true>);
}
