import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Grant, Principal } from '@uw/contracts';
import {
  actionForVerbRole,
  can,
  adminAreas,
  grantedAreas,
  minimumRole,
  readableAreas,
  rowReadRules,
  type AclAction,
  type AclResource,
  type CredentialCapability,
  type CredentialResource,
  type RestrictedTable,
  type RowResource,
} from './acl.ts';
import { parsePrincipal, personPrincipal } from './principal.ts';

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
  ['area admin reads its own area', [area('admin', '80-89')], 'read', software, true],
  ['area admin may not read another area', [area('admin', '80-89')], 'read', finance, false],
  ['editor writes its own area', [area('editor', '80-89')], 'write', software, true],
  ['editor may not write another area', [area('editor', '80-89')], 'write', finance, false],
  ['editor reads its own area', [area('editor', '80-89')], 'read', software, true],
  ['editor may not read another area', [area('editor', '80-89')], 'read', finance, false],
  ['editor may not administer its area', [area('editor', '80-89')], 'admin', software, false],
  ['viewer reads its own area', [area('viewer', '80-89')], 'read', software, true],
  ['viewer may not read another area', [area('viewer', '80-89')], 'read', finance, false],
  ['viewer may not write its own area', [area('viewer', '80-89')], 'write', software, false],
  ['org editor writes every area', [org('editor')], 'write', finance, true],
  ['org viewer reads every area', [org('viewer')], 'read', finance, true],
  ['org editor reads every area', [org('editor')], 'read', finance, true],
  ['org admin reads every area', [org('admin')], 'read', finance, true],
  [
    'grants on two areas read both and no third',
    [area('viewer', '80-89'), area('editor', '20-29')],
    'read',
    { kind: 'area', area: '40-49' },
    false,
  ],
  ['org viewer may not write', [org('viewer')], 'write', software, false],
  ['no grant may do nothing', [], 'read', software, false],
  ['grants add up', [area('viewer', '80-89'), area('editor', '20-29')], 'write', finance, true],
  ['area editor may not write the org', [area('editor', '80-89')], 'write', wholeOrg, false],
  ['area viewer may not read the org', [area('viewer', '80-89')], 'read', wholeOrg, false],
  ['area editor may not read the org', [area('editor', '80-89')], 'read', wholeOrg, false],
  ['area admin may not read the org', [area('admin', '80-89')], 'read', wholeOrg, false],
  ['org viewer may read the org', [org('viewer')], 'read', wholeOrg, true],
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
    expectTypeOf(can).parameters.toEqualTypeOf<
      [
        Principal,
        AclAction | CredentialCapability,
        AclResource | RowResource | CredentialResource,
        Date,
      ]
    >();
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

function viewing(...grants: Grant[]): ReturnType<typeof readableAreas> {
  return readableAreas(holding(...grants), at);
}

describe('readableAreas names exactly the areas can() lets a principal read', () => {
  it('names every area for an org viewer', () => {
    expect(viewing(org('viewer'))).toEqual({ kind: 'all' });
  });

  it('names only its own area for an editor or admin on one area', () => {
    expect(viewing(area('editor', '80-89'))).toEqual({ kind: 'some', areas: ['80-89'] });
    expect(viewing(area('admin', '20-29'))).toEqual({ kind: 'some', areas: ['20-29'] });
  });

  it('names every area for an org grant of any role', () => {
    expect(viewing(org('editor'))).toEqual({ kind: 'all' });
    expect(viewing(org('admin'))).toEqual({ kind: 'all' });
  });

  it('names the sorted, distinct areas of area viewers', () => {
    const grants = [area('viewer', '80-89'), area('viewer', '30-39'), area('viewer', '80-89')];
    expect(viewing(...grants)).toEqual({ kind: 'some', areas: ['30-39', '80-89'] });
  });

  it('names no area for a viewer grant that expires at or before the instant', () => {
    const expired: Grant = { ...area('viewer', '80-89'), expiresAt: at.toISOString() };
    expect(viewing(expired)).toEqual({ kind: 'some', areas: [] });
  });

  it('names no area for a principal with no grants', () => {
    expect(viewing()).toEqual({ kind: 'some', areas: [] });
  });
});

function granted(...grants: Grant[]): ReturnType<typeof grantedAreas> {
  return grantedAreas(holding(...grants), at);
}

describe('#104 grantedAreas names the areas a person holds a grant in', () => {
  it('names every area for any org grant', () => {
    expect(granted(org('viewer'))).toEqual({ kind: 'all' });
  });

  it('names only its own area for an area editor or admin', () => {
    expect(granted(area('editor', '80-89'))).toEqual({ kind: 'some', areas: ['80-89'] });
    expect(granted(area('admin', '30-39'))).toEqual({ kind: 'some', areas: ['30-39'] });
  });

  it('names the sorted, distinct areas of every role', () => {
    const grants = [area('admin', '80-89'), area('viewer', '30-39'), area('editor', '80-89')];
    expect(granted(...grants)).toEqual({ kind: 'some', areas: ['30-39', '80-89'] });
  });

  it('names no area for an expired grant or no grant', () => {
    const expired: Grant = { ...org('admin'), expiresAt: at.toISOString() };
    expect(granted(expired)).toEqual({ kind: 'some', areas: [] });
    expect(granted()).toEqual({ kind: 'some', areas: [] });
  });
});

function administered(...grants: Grant[]): ReturnType<typeof adminAreas> {
  return adminAreas(holding(...grants), at);
}

describe('#111 adminAreas names the areas a person may create a workflow in', () => {
  it('names every area for an org admin and none for a lesser org role', () => {
    expect(administered(org('admin'))).toEqual({ kind: 'all' });
    expect(administered(org('editor'))).toEqual({ kind: 'some', areas: [] });
  });

  it('names the sorted, distinct areas held as admin and leaves out the rest', () => {
    const grants = [
      area('admin', '80-89'),
      area('editor', '30-39'),
      area('admin', '20-29'),
      area('admin', '80-89'),
    ];
    expect(administered(...grants)).toEqual({ kind: 'some', areas: ['20-29', '80-89'] });
  });

  it('names no area for an expired admin grant', () => {
    const expired: Grant = { ...area('admin', '80-89'), expiresAt: at.toISOString() };
    expect(administered(expired)).toEqual({ kind: 'some', areas: [] });
  });
});

const owner = '00000000-0000-4000-8000-000000000042';

function row(table: RestrictedTable, rowArea: string | null, ownerId: string | null): RowResource {
  return { kind: 'row', table, area: rowArea, ownerId };
}

type RowCase = [string, Grant[], RowResource, boolean];

const rowMatrix: RowCase[] = [
  ['org viewer', [org('viewer')], row('delegations', '20-29', owner), false],
  ['org editor', [org('editor')], row('gate_decisions', '20-29', null), false],
  ['org admin', [org('admin')], row('delegations', '20-29', owner), true],
  ['viewer on the exact area', [area('viewer', '20-29')], row('delegations', '20-29', owner), true],
  ['admin on another area', [area('admin', '80-89')], row('delegations', '20-29', owner), false],
  ['org viewer, an area grant', [org('viewer')], row('role_grants', '20-29', owner), false],
  [
    'editor on the grant area',
    [area('editor', '20-29')],
    row('role_grants', '20-29', owner),
    false,
  ],
  ['admin of the grant area', [area('admin', '20-29')], row('role_grants', '20-29', owner), true],
  ['area admin, an org grant', [area('admin', '20-29')], row('role_grants', null, owner), false],
  ['org admin, an org grant', [org('admin')], row('grant_audit', null, owner), true],
  [
    'area admin, a service token',
    [area('admin', '20-29')],
    row('service_tokens', null, owner),
    false,
  ],
  ['org admin, a push subscription', [org('admin')], row('push_subscriptions', null, owner), true],
  ['the person it belongs to', [], row('push_subscriptions', null, personId), true],
  ['the person a grant is for', [], row('role_grants', '20-29', personId), true],
  ['the decider with no grant', [], row('gate_decisions', '20-29', personId), false],
];

describe('#155 a restricted row is read on its own area, by its owner, or by an org admin', () => {
  it.each(rowMatrix)('%s reads the row: %s', (_who, grants, resource, expected) => {
    expect(can(holding(...grants), 'read', resource, at)).toBe(expected);
  });

  it('answers read only, so a row is never written or administered through its rule', () => {
    const everything = holding(org('admin'), area('admin', '20-29'));
    expect(can(everything, 'write', row('delegations', '20-29', personId), at)).toBe(false);
    expect(can(everything, 'admin', row('delegations', '20-29', personId), at)).toBe(false);
  });

  it('does not let an agent read as the person it is bound to', () => {
    const agent = parsePrincipal({
      identity: `agent:${personId}/laptop`,
      kind: 'agent',
      personId,
      email: null,
      grants: [],
      interactive: false,
    });
    expect(can(agent, 'read', row('service_tokens', null, personId), at)).toBe(false);
  });

  it('ignores an expired grant on the row area', () => {
    const lapsed = { ...area('admin', '20-29'), expiresAt: '2026-09-01T00:00:00.000Z' };
    expect(can(holding(lapsed), 'read', row('delegations', '20-29', owner), at)).toBe(false);
  });

  it('declares a rule that names an area role, an owner, or both, for every table', () => {
    for (const rule of Object.values(rowReadRules)) {
      expect(rule.area !== null || rule.owner).toBe(true);
    }
  });
});
