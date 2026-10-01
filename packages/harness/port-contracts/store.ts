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
  });
}

export function describeStoreNotWired(adapter: string, store: Store): void {
  describeNotWired('store', adapter, store, {
    transaction: true,
    appliedMigrations: true,
  } satisfies Record<keyof Store, true>);
}
