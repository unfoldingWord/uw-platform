import type { Grant, Identity, JdArea, Principal } from '@uw/contracts';
import { allowed } from '../access.ts';
import type { Delegation } from '../ports.ts';

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
  at: Date,
): Grant | null {
  const found = grants.find((grant) =>
    allowed(delegatePrincipal(delegation, [grant]), 'admin', { jdArea: area }, at),
  );
  return found ?? null;
}

function earlier(grantExpiry: string | null, delegationExpiry: Date): string {
  if (grantExpiry === null) return delegationExpiry.toISOString();
  const grantMs = new Date(grantExpiry).getTime();
  return grantMs < delegationExpiry.getTime()
    ? new Date(grantMs).toISOString()
    : delegationExpiry.toISOString();
}

export function beatPrincipal(
  delegation: Delegation,
  grants: readonly Grant[],
  area: JdArea,
  at: Date,
): Principal {
  const held = delegation.capability === 'none' ? null : adminGrantOn(delegation, grants, area, at);
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
