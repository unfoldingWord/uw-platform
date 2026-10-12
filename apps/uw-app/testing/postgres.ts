import { createClient, type Database } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import type { Clock } from '@uw/harness';
import type { AppDeps } from '../deps.ts';
import { systemClock } from '../ports/clock.ts';
import { systemTimers } from '../timers.ts';
import type { AccessFixture } from './access-keys.ts';

export { testServer };

export async function withAppDatabase<T>(work: (db: Database) => Promise<T>): Promise<T> {
  return withMigratedDatabase(testServer ?? '', async (target) => {
    const db = createClient(target);
    try {
      return await work(db);
    } finally {
      await db.$client.end();
    }
  });
}

export function postgresDeps(
  db: Database,
  fixture: AccessFixture,
  sink: AppDeps['sink'] = () => undefined,
  clock: Clock = systemClock,
): AppDeps {
  return {
    openDatabase: () => ({ db, ping: async () => undefined, release: async () => undefined }),
    accessKeys: () => fixture.keys,
    newId: () => crypto.randomUUID(),
    sink,
    clock,
    timers: systemTimers,
    fetch: () => Promise.reject(new Error('no network in this test')),
  };
}
