import type { MiddlewareHandler } from 'hono';
import { serviceTokenPrincipal } from '@uw/core/principal';
import type { AppDeps, AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { ACCESS_JWT_HEADER, accessConfigFrom, verifyAccessJwt } from './access.ts';

export function withPrincipal(
  deps: Pick<AppDeps, 'accessKeys' | 'openDatabase'>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const config = accessConfigFrom(c.env);
    if (!config) return refuse(c, 'access_not_configured');
    const token = c.req.header(ACCESS_JWT_HEADER);
    const identity = token ? await verifyAccessJwt(token, config, deps.accessKeys(config)) : null;
    if (!identity) return refuse(c, 'unauthenticated');
    if (identity.kind === 'service') {
      c.set('principal', serviceTokenPrincipal(identity.clientId));
      return next();
    }
    if (c.get('database') === null) return refuse(c, 'database_not_configured');
    return refuse(c, 'not_wired');
  };
}
