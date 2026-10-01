import { createClient, type Database } from '@uw/db/client';
import { testServer, withMigratedDatabase } from '@uw/db/test-database';
import type { AppDeps } from '../deps.ts';
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
): AppDeps {
  return {
    openDatabase: () => ({ db, ping: async () => undefined, release: async () => undefined }),
    accessKeys: () => fixture.keys,
    newId: () => crypto.randomUUID(),
    sink,
  };
}
