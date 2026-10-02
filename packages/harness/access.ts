import type { Harness, Principal } from '@uw/contracts';
import { can, type AclAction } from '@uw/core/acl';

export function allowed(
  actor: Principal,
  action: AclAction,
  harness: Pick<Harness, 'jdArea'>,
  at: Date,
): boolean {
  return can(actor, action, { kind: 'area', area: harness.jdArea }, at);
}

export function bareAgent(identity: string): boolean {
  return identity.startsWith('agent:') && !identity.includes('/');
}
