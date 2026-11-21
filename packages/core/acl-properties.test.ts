import { describe, expect, it } from 'vitest';
import type { Grant, Principal } from '@uw/contracts';
import { canReadProperty, propertyAccess, type PropertyRule } from './acl.ts';
import { personPrincipal } from './principal.ts';

const personId = '00000000-0000-4000-8000-000000000009';
const other = '00000000-0000-4000-8000-000000000010';
const at = new Date('2026-11-21T12:00:00.000Z');
const rule: PropertyRule = { steward: '10-19', role: 'viewer', owner: true };

function holding(...grants: Grant[]): Principal {
  return personPrincipal({ personId, email: 'p@unfoldingword.org', grants, interactive: true });
}

function grant(role: Grant['role'], scope: string | null, expiresAt: string | null = null): Grant {
  const grantId = '00000000-0000-4000-8000-000000000909';
  if (scope === null) return { grantId, role, scopeKind: 'org', scopeArea: null, expiresAt };
  return { grantId, role, scopeKind: 'jd_area', scopeArea: scope, expiresAt };
}

describe('#206 a property narrower than its row is read by its rule', () => {
  it('reads an internal property for everyone', () => {
    expect(propertyAccess(holding(), null, '00-09', at)).toBe('all');
  });

  it('reads every row for the steward area and the org admin, and none for an org viewer', () => {
    expect(propertyAccess(holding(grant('viewer', '10-19')), rule, '00-09', at)).toBe('all');
    expect(propertyAccess(holding(grant('admin', null)), rule, '00-09', at)).toBe('all');
    expect(propertyAccess(holding(grant('editor', null)), rule, '00-09', at)).toBe('own');
  });

  it('reads only the row a person owns when the rule lets the owner read', () => {
    const reader = holding(grant('editor', '00-09'));
    expect(canReadProperty(reader, rule, { area: '00-09', ownerId: personId }, at)).toBe(true);
    expect(canReadProperty(reader, rule, { area: '00-09', ownerId: other }, at)).toBe(false);
  });

  it('reads nothing when the owner may not and the grant has lapsed', () => {
    const closed: PropertyRule = { ...rule, owner: false };
    const lapsed = holding(grant('viewer', '10-19', '2026-11-01T00:00:00.000Z'));
    expect(propertyAccess(lapsed, closed, '00-09', at)).toBe('none');
  });

  it('uses the row area when the rule names no steward', () => {
    const own: PropertyRule = { steward: null, role: 'editor', owner: false };
    expect(propertyAccess(holding(grant('editor', '60-69')), own, '60-69', at)).toBe('all');
    expect(propertyAccess(holding(grant('viewer', '60-69')), own, '60-69', at)).toBe('none');
  });
});
