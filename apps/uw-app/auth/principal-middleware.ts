import type { Context, MiddlewareHandler } from 'hono';
import { personPrincipal, serviceTokenPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import { giveDefaultReading } from '../acl/default-grant.ts';
import type { AppDeps, AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { signIn } from '../people/directory.ts';
import {
  ACCESS_JWT_HEADER,
  accessConfigFrom,
  surfaceOf,
  verifyAccessJwt,
  type AccessIdentity,
  type AccessSurface,
} from './access.ts';
import { devEmail } from './dev-principal.ts';
import { accessDeclinedPage, pendingApprovalPage } from './pending-approval.tsx';

type Keys = Pick<AppDeps, 'accessKeys'>;

async function verifiedIdentity(
  c: Context<AppEnv>,
  deps: Keys,
  surface: AccessSurface,
): Promise<AccessIdentity | Response> {
  const config = accessConfigFrom(c.env, surface);
  if (!config) return refuse(c, 'access_not_configured');
  const token = c.req.header(ACCESS_JWT_HEADER);
  const identity = token ? await verifyAccessJwt(token, config, deps.accessKeys(config)) : null;
  if (identity?.kind === 'service' && surface !== 'mcp') return refuse(c, 'unauthenticated');
  return identity ?? refuse(c, 'unauthenticated');
}

function refuseInactive(
  c: Context<AppEnv>,
  status: 'pending' | 'disabled',
): Response | Promise<Response> {
  const reason = status === 'pending' ? 'pending_approval' : 'not_permitted';
  c.set('outcome', reason);
  if (!c.req.header('accept')?.includes('text/html')) return refuse(c, reason);
  return status === 'pending' ? pendingApprovalPage(c) : accessDeclinedPage(c);
}

async function grantsWithDefault(db: Database, personId: string, at: Date, traceId: string) {
  const held = await resolveGrants(db, personId, { at });
  if (held.length > 0) return held;
  const given = await giveDefaultReading(db, personId, { actor: null, traceId });
  return given ? resolveGrants(db, personId, { at }) : held;
}

export function withPrincipal(
  deps: Pick<AppDeps, 'accessKeys' | 'clock'>,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const now = deps.clock.now();
    c.set('now', now);
    c.set('access', null);
    const dev = devEmail(c.env, c.req.url);
    const identity: AccessIdentity | Response = dev
      ? { kind: 'person', email: dev }
      : await verifiedIdentity(c, deps, surfaceOf(c.req.path));
    if (identity instanceof Response) return identity;
    c.set('access', identity);
    if (identity.kind === 'service') {
      c.set('principal', serviceTokenPrincipal(identity.clientId));
      return next();
    }
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    const person = await signIn(database.db, identity.email);
    if (person.status !== 'active') return refuseInactive(c, person.status);
    const grants = await grantsWithDefault(database.db, person.personId, now, c.get('traceId'));
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
