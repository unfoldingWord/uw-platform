import type { MiddlewareHandler } from 'hono';
import { setMetric, timing } from 'hono/timing';
import { createLogger } from '@uw/core/log';
import { TRACE_HEADER } from '@uw/core/trace';
import type { AppDeps, AppEnv } from './deps.ts';
import { commitOf } from './env.ts';
import { requestLogger } from './request-logger.ts';

export function observe(deps: Pick<AppDeps, 'newId' | 'sink'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = Date.now();
    const traceId = deps.newId();
    const logger = createLogger(
      { traceId, commit: commitOf(c.env), route: c.req.method, principal: null },
      deps.sink,
    );
    c.set('traceId', traceId);
    c.set('logger', logger);
    c.set('principal', null);
    c.set('outcome', null);
    await next();
    c.header(TRACE_HEADER, traceId);
    const stats = c.get('database')?.stats?.();
    requestLogger(c).info('request', {
      outcome: c.get('outcome') ?? `http_${c.res.status}`,
      latencyMs: Date.now() - started,
      queries: stats?.queries,
      transactions: stats?.transactions,
    });
  };
}

export function serverTiming(): MiddlewareHandler<AppEnv> {
  const timed = timing({ totalDescription: 'whole request' });
  return (c, next) =>
    timed(c, async () => {
      await next();
      const stats = c.get('database')?.stats?.();
      if (stats !== undefined) {
        setMetric(c, 'db', `${stats.queries} queries in ${stats.transactions} transactions`);
      }
    });
}
