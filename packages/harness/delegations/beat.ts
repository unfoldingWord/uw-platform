import type { Grant, Identity, JdArea, Principal } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Delegation } from '../ports.ts';

const BEFORE_ANY_EXPIRY = new Date(0);
const ASSUMING = ' as ';
const VIA_DELEGATION = ' via delegation:';

export function personaMatches(identity: Identity, delegation: Delegation): boolean {
  if (identity === delegation.persona) return true;
  const asAt = identity.indexOf(ASSUMING);
  const viaAt = identity.indexOf(VIA_DELEGATION);
  if (!identity.startsWith('agent:') || asAt < 0 || viaAt < asAt + ASSUMING.length) return false;
  const slug = identity.slice(asAt + ASSUMING.length, viaAt);
  const id = identity.slice(viaAt + VIA_DELEGATION.length);
  return `agent:${slug}` === delegation.persona && id === delegation.id;
}

function delegatePrincipal(delegation: Delegation, grants: readonly Grant[]): Principal {
  return {
    identity: delegation.persona,
    kind: 'agent',
    personId: delegation.personId,
    email: null,
    grants: [...grants],
    interactive: false,
  };
}

export function adminGrantOn(
  delegation: Delegation,
  grants: readonly Grant[],
  area: JdArea,
): Grant | null {
  const found = grants.find((grant) =>
    allowed(delegatePrincipal(delegation, [grant]), 'admin', { jdArea: area }, BEFORE_ANY_EXPIRY),
  );
  return found ?? null;
}

function earlier(grantExpiry: string | null, delegationExpiry: Date): string {
  const own = delegationExpiry.toISOString();
  return grantExpiry !== null && grantExpiry < own ? grantExpiry : own;
}

export function beatPrincipal(
  delegation: Delegation,
  grants: readonly Grant[],
  area: JdArea,
): Principal {
  const held = delegation.capability === 'none' ? null : adminGrantOn(delegation, grants, area);
  if (held === null) return delegatePrincipal(delegation, []);
  return delegatePrincipal(delegation, [
    {
      grantId: held.grantId,
      role: 'editor',
      scopeKind: 'jd_area',
      scopeArea: area,
      expiresAt: earlier(held.expiresAt, delegation.expiresAt),
    },
  ]);
}
