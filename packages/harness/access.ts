import {
  deviceOwnerSegment,
  ingestIdentity,
  systemIdentity,
  type Harness,
  type Principal,
} from '@uw/contracts';
import { can, type AclAction } from '@uw/core/acl';

export const topicLinkIdentity = systemIdentity;

export function allowed(
  actor: Principal,
  action: AclAction,
  harness: Pick<Harness, 'jdArea'>,
  at: Date,
): boolean {
  return can(actor, action, { kind: 'area', area: harness.jdArea }, at);
}

export function isAgent(actor: Principal): boolean {
  return actor.kind === 'agent' || !actor.identity.startsWith('human:');
}

export function ownerBound(actor: Principal): boolean {
  const owner = deviceOwnerSegment(actor.identity);
  return owner === null || owner === actor.personId;
}

export function bareAgent(identity: string): boolean {
  return identity.startsWith('agent:') && !identity.includes('/');
}

export function isSystemPrincipal(actor: Principal): boolean {
  return (
    actor.identity === systemIdentity &&
    actor.kind === 'agent' &&
    actor.personId === null &&
    actor.grants.length === 0 &&
    !actor.interactive
  );
}

export function isIngestPrincipal(actor: Principal): boolean {
  return (
    actor.identity === ingestIdentity &&
    actor.kind === 'agent' &&
    actor.personId === null &&
    actor.grants.length === 0 &&
    !actor.interactive
  );
}

export function platformIdentity(identity: string): boolean {
  return identity === systemIdentity || identity === ingestIdentity;
}
