import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { createClient, type Database } from '@uw/db/client';
import { sharingReads } from '@uw/db/store';
import type { Logger } from '@uw/core/log';
import type { Principal } from '@uw/core/principal';
import type { Bindings } from './env.ts';
import { requestLogger } from './request-logger.ts';

export type DatabaseStats = { readonly queries: number; readonly transactions: number };

export type DatabaseHandle = {
  readonly db: Database;
  ping(): Promise<void>;
  release(): Promise<void>;
  stats?(): DatabaseStats;
};

export function queryCounter(): {
  readonly count: (query: string) => void;
  stats(): DatabaseStats;
} {
  let queries = 0;
  let transactions = 0;
  return {
    count: (query) => {
      if (/^\s*begin\b/i.test(query)) transactions += 1;
      else if (!/^\s*(commit|rollback)\b/i.test(query)) queries += 1;
    },
    stats: () => ({ queries, transactions }),
  };
}

export function hyperdriveDatabase(env: Bindings): DatabaseHandle | null {
  if (!env.HYPERDRIVE) return null;
  const counter = queryCounter();
  const db = createClient(env.HYPERDRIVE.connectionString, counter.count);
  return {
    db,
    stats: counter.stats,
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

function pageRead(method: string, path: string): boolean {
  return method === 'GET' && !path.startsWith('/api/') && !path.startsWith('/mcp');
}

export function shareReadsOnPages(): MiddlewareHandler {
  return (c, next) => (pageRead(c.req.method, c.req.path) ? sharingReads(next) : next());
}
