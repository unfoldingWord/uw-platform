import type { Grant, Identity } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { beatPrincipal, personaMatches } from './beat.ts';
import type { Delegation } from '../ports.ts';

const delegationId = '00000000-0000-4000-8000-0000000d0001';

function delegationOf(persona: string): Delegation {
  return {
    id: delegationId,
    personId: '00000000-0000-4000-8000-000000000104',
    persona: persona as Identity,
    harnessId: '00000000-0000-4000-8000-0000000d0002',
    capability: 'iterate',
    grantedAt: new Date('2026-10-01T09:00:00.000Z'),
    expiresAt: new Date('2026-12-30T09:00:00.000Z'),
    revokedAt: null,
    lapsedAt: null,
    supersedes: null,
  };
}

function matches(identity: string): boolean {
  return personaMatches(identity as Identity, delegationOf('agent:iterate'));
}

describe('KN-16 a delegation names the persona that may act under it', () => {
  it('matches the persona itself', () => {
    expect(matches('agent:iterate')).toBe(true);
  });

  it('matches a device identity acting as the persona via this delegation', () => {
    expect(matches(`agent:jesse/laptop as iterate via delegation:${delegationId}`)).toBe(true);
  });

  it('does not match another persona', () => {
    expect(matches('agent:builder')).toBe(false);
    expect(matches(`agent:jesse/laptop as builder via delegation:${delegationId}`)).toBe(false);
  });

  it('does not match another delegation, a bare device, or a human', () => {
    expect(matches('agent:jesse/laptop as iterate via delegation:other')).toBe(false);
    expect(matches('agent:jesse/laptop')).toBe(false);
    expect(matches('human:00000000-0000-4000-8000-000000000104')).toBe(false);
  });
});

const at = new Date('2026-10-01T09:00:00.000Z');

function adminGrant(scope: 'org' | 'area', expiresAt: string | null): Grant {
  const grantId = '00000000-0000-4000-8000-0000000d0003';
  if (scope === 'org')
    return { grantId, role: 'admin', scopeKind: 'org', scopeArea: null, expiresAt };
  return { grantId, role: 'admin', scopeKind: 'jd_area', scopeArea: '80-89', expiresAt };
}

describe('KN-16 the beat principal is bounded by the grant and the delegation', () => {
  it('holds nothing from an expired admin grant passed in directly', () => {
    const expired = adminGrant('area', '2026-10-01T08:00:00.000Z');
    expect(beatPrincipal(delegationOf('agent:iterate'), [expired], '80-89', at).grants).toEqual([]);
  });

  it('clamps the expiry to the earlier of the grant and the delegation', () => {
    const delegation = delegationOf('agent:iterate');
    const soon = adminGrant('area', '2026-11-01T00:00:00.000Z');
    const never = adminGrant('area', null);
    expect(beatPrincipal(delegation, [soon], '80-89', at).grants[0]?.expiresAt).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(beatPrincipal(delegation, [never], '80-89', at).grants[0]?.expiresAt).toBe(
      delegation.expiresAt.toISOString(),
    );
    const later = adminGrant('area', '2027-06-01T00:00:00.000Z');
    expect(beatPrincipal(delegation, [later], '80-89', at).grants[0]?.expiresAt).toBe(
      delegation.expiresAt.toISOString(),
    );
  });

  it('narrows an org admin to an editor on the area', () => {
    const principal = beatPrincipal(
      delegationOf('agent:iterate'),
      [adminGrant('org', null)],
      '80-89',
      at,
    );
    expect(principal.grants.map((grant) => [grant.role, grant.scopeKind, grant.scopeArea])).toEqual(
      [['editor', 'jd_area', '80-89']],
    );
  });
});
