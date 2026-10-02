import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  delegatedIdentity,
  deviceSegmentSchema,
  personaSlugSchema,
  principalSchema,
  serviceClientIdSchema,
  type Grant,
  type Principal,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import { liveBinding } from '../agents/service-tokens.ts';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { personById } from '../people/directory.ts';

const DEVICE_HEADER = 'x-uw-device';
const PERSONA_HEADER = 'x-uw-persona';
const DELEGATION_HEADER = 'x-uw-delegation';
const MINTING_ROLES: ReadonlySet<string> = new Set(['editor', 'admin']);

type AgentClaim = {
  readonly device: string | null;
  readonly delegation: { readonly personaSlug: string; readonly delegationId: string } | null;
};

function delegationOf(
  persona: string | undefined,
  delegation: string | undefined,
): AgentClaim['delegation'] | undefined {
  if (persona === undefined && delegation === undefined) return null;
  const slug = personaSlugSchema.safeParse(persona);
  const id = z.uuid().safeParse(delegation);
  if (!slug.success || !id.success) return undefined;
  return { personaSlug: slug.data, delegationId: id.data };
}

export function agentClaimOf(header: (name: string) => string | undefined): AgentClaim | null {
  const device = header(DEVICE_HEADER);
  if (device !== undefined && !deviceSegmentSchema.safeParse(device).success) return null;
  const delegation = delegationOf(header(PERSONA_HEADER), header(DELEGATION_HEADER));
  if (delegation === undefined) return null;
  return { device: device ?? null, delegation };
}

export function mayMint(grants: readonly Grant[], at: Date): boolean {
  return grants.some(
    (grant) =>
      MINTING_ROLES.has(grant.role) &&
      (grant.expiresAt === null || new Date(grant.expiresAt).getTime() > at.getTime()),
  );
}

export function mintAgent(
  owner: { readonly personId: string; readonly grants: readonly Grant[] },
  device: string,
  delegation: AgentClaim['delegation'],
  interactive: boolean,
): Principal {
  const base = `agent:${owner.personId}/${device}`;
  const identity =
    delegation === null
      ? base
      : delegatedIdentity(base, delegation.personaSlug, delegation.delegationId);
  return principalSchema.parse({
    identity,
    kind: 'agent',
    personId: owner.personId,
    email: null,
    grants: [...owner.grants],
    interactive,
  });
}

type Owner = {
  readonly personId: string;
  readonly grants: readonly Grant[];
  readonly device: string;
  readonly interactive: boolean;
};

function personOwner(c: Context<AppEnv>, claim: AgentClaim): Owner | Response {
  const person = c.get('principal');
  if (person?.kind !== 'person' || person.personId === null) return refuse(c, 'unauthenticated');
  if (claim.device === null) return refuse(c, 'malformed_command');
  return {
    personId: person.personId,
    grants: person.grants,
    device: claim.device,
    interactive: true,
  };
}

async function serviceOwner(
  c: Context<AppEnv>,
  db: Database,
  rawClientId: string,
  claim: AgentClaim,
): Promise<Owner | Response> {
  const clientId = serviceClientIdSchema.safeParse(rawClientId);
  if (!clientId.success) return refuse(c, 'unauthenticated');
  const binding = await liveBinding(db, clientId.data);
  if (binding === null) return refuse(c, 'unauthenticated');
  if (claim.device !== null && claim.device !== binding.device) {
    return refuse(c, 'malformed_command');
  }
  const person = await personById(db, binding.personId);
  if (person?.status !== 'active') return refuse(c, 'pending_approval');
  const grants = await resolveGrants(db, binding.personId, { at: c.get('now') });
  return { personId: binding.personId, grants, device: binding.device, interactive: false };
}

export function withAgentPrincipal(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const access = c.get('access');
    if (!access) return refuse(c, 'unauthenticated');
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    const claim = agentClaimOf((name) => c.req.header(name));
    if (claim === null) return refuse(c, 'malformed_command');
    const owner =
      access.kind === 'person'
        ? personOwner(c, claim)
        : await serviceOwner(c, database.db, access.clientId, claim);
    if (owner instanceof Response) return owner;
    if (!mayMint(owner.grants, c.get('now'))) return refuse(c, 'not_permitted');
    c.set('principal', mintAgent(owner, owner.device, claim.delegation, owner.interactive));
    return next();
  };
}
