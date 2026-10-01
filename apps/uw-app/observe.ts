import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { createLogger } from '@uw/core/log';
import { TRACE_HEADER } from '@uw/core/trace';
import type { AppDeps, AppEnv } from './deps.ts';
import { commitOf } from './env.ts';

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
    logger
      .with({
        route: `${c.req.method} ${routePath(c, -1)}`,
        principal: c.get('principal')?.identity ?? null,
      })
      .info('request', {
        outcome: c.get('outcome') ?? `http_${c.res.status}`,
        latencyMs: Date.now() - started,
      });
  };
}
