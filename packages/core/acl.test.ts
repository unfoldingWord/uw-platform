import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Grant, Principal } from '@uw/contracts';
import { actionForVerbRole, can, minimumRole, type AclAction, type AclResource } from './acl.ts';
import { personPrincipal } from './principal.ts';

const personId = '00000000-0000-4000-8000-000000000009';
const grantId = '00000000-0000-4000-8000-000000000909';

function holding(...grants: Grant[]): Principal {
  return personPrincipal({ personId, email: 'p@unfoldingword.org', grants, interactive: true });
}
const org = (role: Grant['role']): Grant => ({
  grantId,
  role,
  scopeKind: 'org',
  scopeArea: null,
  expiresAt: null,
});
const area = (role: Grant['role'], scopeArea: string): Grant => ({
  grantId,
  role,
  scopeKind: 'jd_area',
  scopeArea,
  expiresAt: null,
});

const at = new Date('2026-10-01T12:00:00.000Z');

const software: AclResource = { kind: 'area', area: '80-89' };
const finance: AclResource = { kind: 'area', area: '20-29' };
const wholeOrg: AclResource = { kind: 'org' };

type Row = [string, Grant[], AclAction, AclResource, boolean];

const matrix: Row[] = [
  ['org admin may administer any area', [org('admin')], 'admin', finance, true],
  ['org admin may administer the org', [org('admin')], 'admin', wholeOrg, true],
  ['area admin may administer its area', [area('admin', '80-89')], 'admin', software, true],
  ['area admin may not administer another area', [area('admin', '80-89')], 'admin', finance, false],
  ['area admin may not administer the org', [area('admin', '80-89')], 'admin', wholeOrg, false],
  ['area admin reads every area', [area('admin', '80-89')], 'read', finance, true],
  ['editor writes its own area', [area('editor', '80-89')], 'write', software, true],
  ['editor may not write another area', [area('editor', '80-89')], 'write', finance, false],
  ['editor reads every area', [area('editor', '80-89')], 'read', finance, true],
  ['editor may not administer its area', [area('editor', '80-89')], 'admin', software, false],
  ['viewer reads its own area', [area('viewer', '80-89')], 'read', software, true],
  ['viewer may not read another area', [area('viewer', '80-89')], 'read', finance, false],
  ['viewer may not write its own area', [area('viewer', '80-89')], 'write', software, false],
  ['org editor writes every area', [org('editor')], 'write', finance, true],
  ['org viewer reads every area', [org('viewer')], 'read', finance, true],
  ['org viewer may not write', [org('viewer')], 'write', software, false],
  ['no grant may do nothing', [], 'read', software, false],
  ['grants add up', [area('viewer', '80-89'), area('editor', '20-29')], 'write', finance, true],
  ['area editor may not write the org', [area('editor', '80-89')], 'write', wholeOrg, false],
  ['area viewer may not read the org', [area('viewer', '80-89')], 'read', wholeOrg, false],
  ['org editor writes the org', [org('editor')], 'write', wholeOrg, true],
  ['org editor may not administer', [org('editor')], 'admin', software, false],
  ['org editor may not administer the org', [org('editor')], 'admin', wholeOrg, false],
];

const actions: AclAction[] = ['read', 'write', 'admin'];

const resources: AclResource[] = [software, finance, wholeOrg];

function orgAdminCoversAreaAdmin(action: AclAction): void {
  const areaAdmin = holding(area('admin', '80-89'));
  const orgAdmin = holding(org('admin'));
  const uncovered = resources.filter(
    (resource) => can(areaAdmin, action, resource, at) && !can(orgAdmin, action, resource, at),
  );
  expect(uncovered).toEqual([]);
  expect(resources.filter((resource) => !can(orgAdmin, action, resource, at))).toEqual([]);
}

describe('FD-8 can()', () => {
  it.each(matrix)('%s', (_label, grants, action, resource, expected) => {
    expect(can(holding(...grants), action, resource, at)).toBe(expected);
  });

  it.each(actions)(
    'lets an org-scope admin do everything an area admin may: %s',
    orgAdminCoversAreaAdmin,
  );

  it('takes a principal, an action and a resource and no database handle', () => {
    expectTypeOf(can).parameters.toEqualTypeOf<[Principal, AclAction, AclResource, Date]>();
    expectTypeOf(can).returns.toEqualTypeOf<boolean>();
  });
});

function expiring(expiresAt: string): Grant {
  return { ...org('admin'), expiresAt };
}

describe('FD-8 can() treats an expired grant as absent', () => {
  it('ignores a grant that expired before the instant asked about', () => {
    expect(can(holding(expiring('2026-10-01T11:59:59.000Z')), 'read', software, at)).toBe(false);
  });

  it('ignores a grant that expires at exactly that instant', () => {
    expect(can(holding(expiring('2026-10-01T12:00:00.000Z')), 'read', software, at)).toBe(false);
  });

  it('honours a grant that has not yet expired', () => {
    expect(can(holding(expiring('2026-10-01T12:00:01.000Z')), 'admin', wholeOrg, at)).toBe(true);
  });

  it('still honours a live grant beside an expired one', () => {
    const grants = [expiring('2000-01-01T00:00:00.000Z'), area('editor', '80-89')];
    expect(can(holding(...grants), 'write', software, at)).toBe(true);
  });
});

const roles: Grant['role'][] = ['viewer', 'editor', 'admin'];

function roundTrips(role: Grant['role']): void {
  expect(minimumRole[actionForVerbRole(role)]).toBe(role);
}

describe('CT-2 FD-8 a verb grant role maps to one can() action', () => {
  it('maps viewer to read, editor to write and admin to admin', () => {
    expect(roles.map(actionForVerbRole)).toEqual(['read', 'write', 'admin']);
  });

  it.each(roles)('round-trips %s through minimumRole', roundTrips);

  it('keeps an editor of another area out of an editor(40-49) verb', () => {
    const gifts: AclResource = { kind: 'area', area: '40-49' };
    const action = actionForVerbRole('editor');
    expect(can(holding(area('editor', '80-89')), action, gifts, at)).toBe(false);
    expect(can(holding(area('editor', '40-49')), action, gifts, at)).toBe(true);
  });
});
