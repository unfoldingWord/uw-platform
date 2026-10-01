import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Grant, Principal } from '@uw/contracts';
import { can, type AclAction, type AclResource } from './acl.ts';
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
];

const actions: AclAction[] = ['read', 'write', 'admin'];

function orgAdminCoversAreaAdmin(action: AclAction): void {
  const areaAdmin = holding(area('admin', '80-89'));
  const orgAdmin = holding(org('admin'));
  if (can(areaAdmin, action, software)) expect(can(orgAdmin, action, software)).toBe(true);
}

describe('FD-8 can()', () => {
  it.each(matrix)('%s', (_label, grants, action, resource, expected) => {
    expect(can(holding(...grants), action, resource)).toBe(expected);
  });

  it.each(actions)(
    'lets an org-scope admin do everything an area admin may: %s',
    orgAdminCoversAreaAdmin,
  );

  it('takes a principal, an action and a resource and no database handle', () => {
    expectTypeOf(can).parameters.toEqualTypeOf<[Principal, AclAction, AclResource]>();
    expectTypeOf(can).returns.toEqualTypeOf<boolean>();
  });
});
