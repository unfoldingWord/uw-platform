import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { createClient, type Database } from '@uw/db/client';
import type { Bindings } from './env.ts';

export type DatabaseHandle = {
  readonly db: Database;
  ping(): Promise<void>;
  release(): Promise<void>;
};

export function hyperdriveDatabase(env: Bindings): DatabaseHandle | null {
  if (!env.HYPERDRIVE) return null;
  const db = createClient(env.HYPERDRIVE.connectionString);
  return {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    release: () => db.$client.end(),
  };
}

type DatabaseEnv = {
  Bindings: Bindings;
  Variables: { database: DatabaseHandle | null };
};

export function withDatabase(deps: {
  readonly openDatabase: (env: Bindings) => DatabaseHandle | null;
}): MiddlewareHandler<DatabaseEnv> {
  return async (c, next) => {
    const handle = deps.openDatabase(c.env);
    c.set('database', handle);
    try {
      await next();
    } finally {
      await handle?.release();
    }
  };
}
