import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Store, StoreTransaction } from '../ports.ts';
import { awaitBlocked, type LockWaiters } from './lock-wait.ts';
import { describeNotWired } from './not-wired-cases.ts';
import { describeStoreGateways, type SeededPage } from './store-gateways.ts';
import { describeStoreRuns } from './store-runs.ts';
import { describeStoreBoundedReads } from './store-bounded-reads.ts';
import { describeStoreFailedFor } from './store-failed-for.ts';
import { describeStoreViews } from './store-views.ts';
import { describeStoreMeasurements } from './store-measurements.ts';
import { describeStoreFreeze } from './store-freeze.ts';
import { describeStoreFixClaim } from './store-fix-claim.ts';
import { describeStoreJoining } from './store-joining.ts';
import { describeStoreItemsEpic } from './store-items-epic.ts';
import { describeStorePersonas, type PageVersionRow } from './store-personas.ts';

export type StoreShape = { readonly concurrentConnections: boolean };

export type StoreSubject = {
  readonly store: Store;
  readonly expectedMigrations: readonly number[];
  seedPage(page: SeededPage): Promise<void>;
  pageVersions(pageId: string): Promise<readonly PageVersionRow[]>;
  advisoryLocksHeld(tx: StoreTransaction): Promise<number>;
  readonly lockWaiters?: LockWaiters;
  close(): Promise<void>;
};

const refusalTimeout = 2_000;

const transactionMembers = [
  'delegations',
  'gateDecisions',
  'harnessEvents',
  'harnessItems',
  'harnessRuns',
  'harnessStages',
  'harnesses',
  'lock',
  'lockShared',
  'measurements',
  'pages',
  'personas',
];

function outcomeOf(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'resolved';
  const reason: unknown = result.reason;
  return reason instanceof Error ? reason.name : 'rejected';
}

async function takeTwice(tx: StoreTransaction): Promise<void> {
  await tx.lock('store-contract');
  await tx.lock('store-contract');
}

async function workThenRecord(order: string[], work: () => Promise<void>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    order.push('first failed');
    return error;
  }
  order.push('first finished');
  return null;
}

type SecondLock = (tx: StoreTransaction) => Promise<void>;

const exclusive: SecondLock = (tx) => tx.lock('store-contract-race');

export async function race(
  store: Store,
  waiters: LockWaiters | undefined,
  firstWork: () => Promise<void>,
  secondLock: SecondLock = exclusive,
): Promise<string[]> {
  const order: string[] = [];
  let signal: () => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const held = new Promise<void>((resolve, reject) => {
    signal = resolve;
    fail = reject;
  });
  let workError: unknown = null;
  let locked = false;
  const first = store
    .transaction(async (tx) => {
      await tx.lock('store-contract-race');
      locked = true;
      signal();
      await awaitBlocked(waiters);
      workError = await workThenRecord(order, firstWork);
      if (workError !== null) throw workError;
    })
    .catch((error: unknown) => {
      fail(error);
      if (locked && error !== workError) throw error;
    });
  await held;
  const second = store.transaction(async (tx) => {
    await secondLock(tx);
    order.push('second locked');
  });
  await Promise.all([first, second]);
  return order;
}

function describeRace(subject: () => StoreSubject): void {
  it('holds a second transaction on a lock until the first commits', async () => {
    expect(await race(subject().store, subject().lockWaiters, async () => undefined)).toEqual([
      'first finished',
      'second locked',
    ]);
  });

  it('releases a lock when the transaction that held it throws', async () => {
    const order = await race(subject().store, subject().lockWaiters, () =>
      Promise.reject(new Error('after the lock')),
    );
    expect(order).toEqual(['first failed', 'second locked']);
  });

  it('holds a shared lock behind an exclusive hold of the same key until the first commits', async () => {
    const shared: SecondLock = (tx) => tx.lockShared('store-contract-race');
    const order = await race(subject().store, subject().lockWaiters, async () => undefined, shared);
    expect(order).toEqual(['first finished', 'second locked']);
  });

  it('lets two transactions hold one key shared at once', async () => {
    expect(await sharedTogether(subject().store)).toEqual(['second shared', 'first finished']);
  });
}

async function sharedTogether(store: Store): Promise<string[]> {
  const order: string[] = [];
  let signal: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    signal = resolve;
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = store.transaction(async (tx) => {
    await tx.lockShared('store-contract-shared');
    signal();
    await gate;
    order.push('first finished');
  });
  await held;
  await store.transaction(async (tx) => {
    await tx.lockShared('store-contract-shared');
    order.push('second shared');
  });
  release();
  await first;
  return order;
}

export async function escapedAfter(
  store: Store,
  call: () => Promise<unknown>,
  failWork: boolean,
): Promise<string[]> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const escaped: { outcomes: Promise<string[]> } = { outcomes: Promise.resolve([]) };
  await store
    .transaction(async () => {
      escaped.outcomes = gate.then(async () =>
        (await Promise.allSettled([call(), store.transaction(async () => 1)])).map(outcomeOf),
      );
      if (failWork) throw new Error('after scheduling');
    })
    .catch(() => undefined);
  release();
  return escaped.outcomes;
}

async function locksHeldAround(subject: StoreSubject, take: SecondLock): Promise<number[]> {
  return subject.store.transaction(async (tx) => {
    const before = await subject.advisoryLocksHeld(tx);
    await take(tx);
    return [before, await subject.advisoryLocksHeld(tx)];
  });
}

function describeExclusion(subject: () => StoreSubject, shape: StoreShape): void {
  if (shape.concurrentConnections) describeRace(subject);

  it('holds the advisory lock in the database while the transaction runs, and frees it at commit', async () => {
    expect(await locksHeldAround(subject(), (tx) => tx.lock('store-contract-visible'))).toEqual([
      0, 1,
    ]);
    expect(await subject().store.transaction((tx) => subject().advisoryLocksHeld(tx))).toBe(0);
  });

  it('holds a shared advisory lock in the database while the transaction runs, and frees it at commit', async () => {
    const shared = (tx: StoreTransaction) => tx.lockShared('store-contract-visible');
    expect(await locksHeldAround(subject(), shared)).toEqual([0, 1]);
    expect(await subject().store.transaction((tx) => subject().advisoryLocksHeld(tx))).toBe(0);
  });

  it(
    'refuses a read outside the open transaction: the work must pass the transaction along',
    async () => {
      const store = subject().store;
      const outcomes = await store.transaction(async () =>
        (
          await Promise.allSettled([store.appliedMigrations(), store.transaction(async () => 1)])
        ).map(outcomeOf),
      );
      expect(outcomes).toEqual([
        'CallOutsideOpenTransactionError',
        'CallOutsideOpenTransactionError',
      ]);
    },
    refusalTimeout,
  );

  it('DX-3 lets a continuation scheduled inside the work call the store after the commit', async () => {
    const store = subject().store;
    expect(await escapedAfter(store, () => store.appliedMigrations(), false)).toEqual([
      'resolved',
      'resolved',
    ]);
  });

  it('DX-3 lets a continuation scheduled inside the work call the store after a rollback', async () => {
    const store = subject().store;
    expect(await escapedAfter(store, () => store.appliedMigrations(), true)).toEqual([
      'resolved',
      'resolved',
    ]);
  });

  it('DX-3 does not nest transactions: the work gets only the two locks and the gateways, so pass the transaction along', async () => {
    const members = await subject().store.transaction(async (tx) => Object.keys(tx).sort());
    expect(members).toEqual(transactionMembers);
  });
}

export function describeStoreContract(
  adapter: string,
  open: () => Promise<StoreSubject>,
  shape: StoreShape,
): void {
  describe(`DX-3 store port contract on ${adapter}`, () => {
    let opened: StoreSubject | undefined;
    beforeAll(async () => {
      opened = await open();
    });
    afterAll(() => opened?.close());
    const subject = (): StoreSubject => {
      if (opened === undefined) throw new Error('the store subject is not open');
      return opened;
    };

    it('reports every migration in the journal as applied, in order', async () => {
      expect(await subject().store.appliedMigrations()).toEqual(subject().expectedMigrations);
    });

    it('returns what the work returns', async () => {
      expect(await subject().store.transaction(async () => 42)).toBe(42);
    });

    it('rejects with the very error the work threw', async () => {
      const failure = new Error('work failed');
      await expect(subject().store.transaction(() => Promise.reject(failure))).rejects.toBe(
        failure,
      );
    });

    it('lets one transaction take a lock twice and a later one take it again', async () => {
      await subject().store.transaction(takeTwice);
      await expect(subject().store.transaction(takeTwice)).resolves.toBeUndefined();
    });

    describeExclusion(subject, shape);
    describeStoreGateways(adapter, subject, shape.concurrentConnections);
    describeStoreRuns(adapter, subject);
    describeStoreViews(adapter, subject);
    describeStoreFailedFor(adapter, subject);
    describeStoreBoundedReads(adapter, subject);
    describeStorePersonas(adapter, subject);
    describeStoreMeasurements(adapter, subject);
    describeStoreJoining(adapter, subject);
    describeStoreFreeze(adapter, subject);
    describeStoreFixClaim(adapter, subject);
    describeStoreItemsEpic(adapter, subject);
  });
}

export function describeStoreNotWired(adapter: string, store: Store): void {
  describeNotWired('store', adapter, store, {
    transaction: true,
    appliedMigrations: true,
  } satisfies Record<keyof Store, true>);
}
