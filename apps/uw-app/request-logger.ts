import type { Context } from 'hono';
import { matchedRoutes } from 'hono/route';
import type { Logger } from '@uw/core/log';
import type { Principal } from '@uw/core/principal';
import type { Bindings } from './env.ts';

const UNMATCHED_ROUTE = 'unmatched';

type LoggedRequestEnv = {
  Bindings: Bindings;
  Variables: { logger: Logger; principal: Principal | null };
};

export function requestLogger<E extends LoggedRequestEnv>(c: Context<E>): Logger {
  const handler = matchedRoutes(c)
    .filter((route) => route.method !== 'ALL')
    .at(-1);
  return c.get('logger').with({
    route: `${c.req.method} ${handler?.path ?? UNMATCHED_ROUTE}`,
    principal: c.get('principal')?.identity ?? null,
  });
}
