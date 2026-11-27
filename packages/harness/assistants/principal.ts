import type { Grant, Principal } from '@uw/contracts';
import type { Delegation } from '../ports.ts';

function earlier(grantExpiry: string | null, delegationExpiry: Date): string {
  if (grantExpiry === null) return delegationExpiry.toISOString();
  const grantMs = new Date(grantExpiry).getTime();
  return new Date(Math.min(grantMs, delegationExpiry.getTime())).toISOString();
}

function liveAt(grant: Grant, at: Date): boolean {
  return grant.expiresAt === null || new Date(grant.expiresAt).getTime() > at.getTime();
}

export function assistantPrincipal(
  delegation: Delegation,
  grants: readonly Grant[],
  at: Date,
): Principal {
  const clamped = grants
    .filter((grant) => liveAt(grant, at))
    .map((grant) => ({
      ...grant,
      role: 'viewer' as const,
      expiresAt: earlier(grant.expiresAt, delegation.expiresAt),
    }));
  return {
    identity: delegation.persona,
    kind: 'agent',
    personId: delegation.personId,
    email: null,
    grants: clamped,
    interactive: false,
  };
}
