import type { Context, MiddlewareHandler } from 'hono';
import { personPrincipal, serviceTokenPrincipal } from '@uw/core/principal';
import { resolveGrants } from '@uw/db/store';
import type { AppDeps, AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { signIn } from '../people/directory.ts';
import {
  ACCESS_JWT_HEADER,
  accessConfigFrom,
  verifyAccessJwt,
  type AccessIdentity,
} from './access.ts';
import { devEmail } from './dev-principal.ts';
import { pendingApprovalPage } from './pending-approval.tsx';

type Keys = Pick<AppDeps, 'accessKeys'>;

async function verifiedIdentity(
  c: Context<AppEnv>,
  deps: Keys,
): Promise<AccessIdentity | Response> {
  const config = accessConfigFrom(c.env);
  if (!config) return refuse(c, 'access_not_configured');
  const token = c.req.header(ACCESS_JWT_HEADER);
  const identity = token ? await verifyAccessJwt(token, config, deps.accessKeys(config)) : null;
  return identity ?? refuse(c, 'unauthenticated');
}

function refusePending(c: Context<AppEnv>): Response | Promise<Response> {
  c.set('outcome', 'pending_approval');
  if (c.req.header('accept')?.includes('text/html')) return pendingApprovalPage(c);
  return refuse(c, 'pending_approval');
}

export function withPrincipal(deps: Pick<AppDeps, 'accessKeys'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const dev = devEmail(c.env, c.req.url);
    const identity: AccessIdentity | Response = dev
      ? { kind: 'person', email: dev }
      : await verifiedIdentity(c, deps);
    if (identity instanceof Response) return identity;
    if (identity.kind === 'service') {
      c.set('principal', serviceTokenPrincipal(identity.clientId));
      return next();
    }
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    const person = await signIn(database.db, identity.email);
    if (person.status === 'pending') return refusePending(c);
    const grants = await resolveGrants(database.db, person.personId, { at: new Date() });
    c.set(
      'principal',
      personPrincipal({
        personId: person.personId,
        email: person.email,
        grants,
        interactive: true,
      }),
    );
    return next();
  };
}
