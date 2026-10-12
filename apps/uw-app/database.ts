import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { createClient, type Database } from '@uw/db/client';
import type { Logger } from '@uw/core/log';
import type { Principal } from '@uw/core/principal';
import type { Bindings } from './env.ts';
import { requestLogger } from './request-logger.ts';

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

async function release(handle: DatabaseHandle | null, logger: Logger): Promise<void> {
  try {
    await handle?.release();
  } catch {
    logger.warn('database release failed', { outcome: 'release_failed' });
  }
}

type DatabaseEnv = {
  Bindings: Bindings;
  Variables: { database: DatabaseHandle | null; logger: Logger; principal: Principal | null };
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
      await release(handle, requestLogger(c));
    }
  };
}
