import { setTimeout as pause } from 'node:timers/promises';
import { identitySchema } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { createClient, type Database } from '../client.ts';
import { createMigratedDatabase, testServer } from '../test-database.ts';
import { seedHarness, seedItem } from '../test-seed.ts';
import { lockWaiters } from './held-locks.ts';
import { createDrizzleStore } from './store.ts';

const HARNESS = 'c1000000-0000-4000-8000-000000000001';
const STAGE = 'c2000000-0000-4000-8000-000000000001';
const ITEM = 'c3000000-0000-4000-8000-000000000001';
const at = new Date('2030-01-01T00:00:00.000Z');
const leaseExpiresAt = new Date('2030-01-01T00:15:00.000Z');

type Connections = {
  readonly one: Database;
  readonly two: Database;
  readonly observer: Database;
};

type Outcome = 'commit' | 'rollback';

class RolledBack extends Error {}

function claimBy(holder: 'agent:a' | 'agent:b') {
  return {
    itemId: ITEM,
    holder: identitySchema.parse(holder),
    claimantKind: 'agent' as const,
    delegationId: null,
    leaseExpiresAt,
    at,
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function awaitWaiting(observer: Database): Promise<void> {
  for (let waited = 0; waited < 3_000; waited += 20) {
    if ((await lockWaiters(observer)) > 0) return;
    await pause(20);
  }
  expect.fail('the second claim was never observed waiting on the row lock');
}

async function race(connections: Connections, first: Outcome): Promise<boolean> {
  const claimed = deferred();
  const finish = deferred();
  const winner = createDrizzleStore(connections.one)
    .transaction(async (tx) => {
      expect(await tx.harnessItems.write.claim(claimBy('agent:a'))).toBe(true);
      claimed.resolve();
      await finish.promise;
      if (first === 'rollback') throw new RolledBack('roll back the first claim');
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
  try {
    await Promise.race([claimed.promise, winner]);
    const second = createDrizzleStore(connections.two).transaction((tx) =>
      tx.harnessItems.write.claim(claimBy('agent:b')),
    );
    try {
      await awaitWaiting(connections.observer);
    } finally {
      finish.resolve();
    }
    return await second;
  } finally {
    finish.resolve();
    await winner;
  }
}

async function holderOf(observer: Database): Promise<string | null> {
  const item = await createDrizzleStore(observer).transaction((tx) =>
    tx.harnessItems.read.byId(ITEM),
  );
  return item?.holder ?? null;
}

async function onRace(work: (connections: Connections) => Promise<void>): Promise<void> {
  const database = await createMigratedDatabase(testServer ?? '');
  const connections = {
    one: createClient(database.connectionString),
    two: createClient(database.connectionString),
    observer: createClient(database.connectionString),
  };
  try {
    await seedHarness(connections.observer, { id: HARNESS, key: 'software', jdArea: '80-89' });
    await seedItem(connections.observer, { id: ITEM, harnessId: HARNESS, stageId: STAGE });
    await work(connections);
  } finally {
    await Promise.all(Object.values(connections).map((db) => db.$client.end()));
    await database.drop();
  }
}

describe.skipIf(!testServer)(
  "KN-5 write.claim is one conditional update: of two transactions racing it without the kernel's locks, exactly one wins",
  () => {
    it('the second claim returns false once the first commits, and the first holder stays', () =>
      onRace(async (connections) => {
        expect(await race(connections, 'commit')).toBe(false);
        expect(await holderOf(connections.observer)).toBe('agent:a');
      }));

    it('the second claim returns true once the first rolls back', () =>
      onRace(async (connections) => {
        expect(await race(connections, 'rollback')).toBe(true);
        expect(await holderOf(connections.observer)).toBe('agent:b');
      }));
  },
);
