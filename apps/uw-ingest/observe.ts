import type { MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import { createLogger } from '@uw/core/log';
import { TRACE_HEADER } from '@uw/core/trace';
import type { IngestDeps, IngestEnv } from './deps.ts';
import { commitOf } from './env.ts';

const UNMATCHED_ROUTE = 'unmatched';
const REFUSAL_FLOOR = 400;

export function observe(deps: Pick<IngestDeps, 'newId' | 'sink'>): MiddlewareHandler<IngestEnv> {
  return async (c, next) => {
    const started = Date.now();
    const traceId = deps.newId();
    c.set(
      'logger',
      createLogger(
        { traceId, commit: commitOf(c.env), route: c.req.method, principal: null },
        deps.sink,
      ),
    );
    c.set('traceId', traceId);
    c.set('outcome', null);
    await next();
    c.header(TRACE_HEADER, traceId);
    const handler = matchedRoutes(c)
      .filter((route) => route.method !== 'ALL')
      .at(-1);
    const logger = c.get('logger').with({
      route: `${c.req.method} ${handler?.path ?? UNMATCHED_ROUTE}`,
    });
    const fields = {
      outcome: c.get('outcome') ?? `http_${c.res.status}`,
      latencyMs: Date.now() - started,
    };
    if (c.res.status >= REFUSAL_FLOOR) logger.warn('request refused', fields);
    else logger.info('request', fields);
  };
}
