import { describe, expect, it } from 'vitest';
import type { Grant, Principal } from '@uw/contracts';
import {
  can,
  credentialRules,
  type AclAction,
  type CredentialBinding,
  type CredentialCapability,
  type CredentialResource,
  type RevealGrant,
} from './acl.ts';
import { parsePrincipal, personPrincipal } from './principal.ts';

const personId = '00000000-0000-4000-8000-000000000009';
const otherPersonId = '00000000-0000-4000-8000-000000000008';
const grantId = '00000000-0000-4000-8000-000000000909';
const credentialId = '00000000-0000-4000-8000-00000000c001';
const otherCredentialId = '00000000-0000-4000-8000-00000000c002';
const at = new Date('2026-10-01T12:00:00.000Z');
const later = '2026-10-01T13:00:00.000Z';
const earlier = '2026-10-01T11:00:00.000Z';

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

function holding(...grants: Grant[]): Principal {
  return personPrincipal({ personId, email: 'p@unfoldingword.org', grants, interactive: true });
}

function lent(...grants: Grant[]): Principal {
  return personPrincipal({ personId, email: 'p@unfoldingword.org', grants, interactive: false });
}

function agent(interactive: boolean, ...grants: Grant[]): Principal {
  return parsePrincipal({
    identity: `agent:${personId}/laptop`,
    kind: 'agent',
    personId,
    email: null,
    grants,
    interactive,
  });
}

const monthlyClose: CredentialBinding = {
  harnessId: '00000000-0000-4000-8000-0000000000b1',
  connectorKey: 'bank-export',
};
const elsewhere: CredentialBinding = {
  harnessId: '00000000-0000-4000-8000-0000000000b2',
  connectorKey: 'bank-export',
};
const otherConnector: CredentialBinding = { ...monthlyClose, connectorKey: 'funder-portal' };

function reveal(person: string, expiresAt: string, credential = credentialId): RevealGrant {
  return { credentialId: credential, personId: person, expiresAt };
}

function finance(over: Partial<CredentialResource> = {}): CredentialResource {
  return {
    kind: 'credential',
    credentialId,
    area: '20-29',
    bindings: [monthlyClose],
    usedBy: null,
    revealGrants: [],
    ...over,
  };
}

const inMonthlyClose = finance({ usedBy: monthlyClose });
const revealable = finance({ revealGrants: [reveal(personId, later)] });

type Case = [string, Grant[], CredentialCapability, CredentialResource, boolean];

const matrix: Case[] = [
  ['a viewer on the area sees it', [area('viewer', '20-29')], 'see', finance(), true],
  ['a viewer on another area does not see it', [area('viewer', '80-89')], 'see', finance(), false],
  ['an admin on another area does not see it', [area('admin', '80-89')], 'see', finance(), false],
  ['an org admin sees it', [org('admin')], 'see', finance(), true],
  ['an org editor cannot see it', [org('editor')], 'see', finance(), false],
  ['an org viewer cannot see it', [org('viewer')], 'see', finance(), false],
  [
    'an editor on the area uses it where bound',
    [area('editor', '20-29')],
    'use',
    inMonthlyClose,
    true,
  ],
  [
    'an admin on the area uses it where bound',
    [area('admin', '20-29')],
    'use',
    inMonthlyClose,
    true,
  ],
  ['a viewer on the area cannot use it', [area('viewer', '20-29')], 'use', inMonthlyClose, false],
  [
    'an editor in 80-89 cannot use a 20-29 credential',
    [area('editor', '80-89')],
    'use',
    inMonthlyClose,
    false,
  ],
  ['an org admin cannot use it in a run', [org('admin')], 'use', inMonthlyClose, false],
  ['an org editor cannot use it', [org('editor')], 'use', inMonthlyClose, false],
  ['an area admin manages it', [area('admin', '20-29')], 'manage', finance(), true],
  ['an area editor cannot manage it', [area('editor', '20-29')], 'manage', finance(), false],
  [
    'an admin on another area cannot manage it',
    [area('admin', '80-89')],
    'manage',
    finance(),
    false,
  ],
  ['an org admin can rotate and revoke it', [org('admin')], 'manage', finance(), true],
  ['an org editor cannot manage it', [org('editor')], 'manage', finance(), false],
  [
    'an area admin cannot reveal without a reveal grant',
    [area('admin', '20-29')],
    'reveal',
    finance(),
    false,
  ],
  ['an org admin cannot reveal without a reveal grant', [org('admin')], 'reveal', finance(), false],
  ['an org admin reveals with a reveal grant', [org('admin')], 'reveal', revealable, true],
  [
    'a viewer on the area reveals with a reveal grant',
    [area('viewer', '20-29')],
    'reveal',
    revealable,
    true,
  ],
  ['a reveal grant without a grant on the area reveals nothing', [], 'reveal', revealable, false],
  [
    'a reveal grant and an org editor grant reveal nothing',
    [org('editor')],
    'reveal',
    revealable,
    false,
  ],
];

describe('#156 a credential answers see, use, reveal and manage by its own rule', () => {
  it.each(matrix)('%s', (_name, grants, capability, resource, expected) => {
    expect(can(holding(...grants), capability, resource, at)).toBe(expected);
  });

  it('never answers read, write or admin, so no credential is reached through a page read', () => {
    const everything = holding(org('admin'), area('admin', '20-29'));
    const open = finance({ usedBy: monthlyClose, revealGrants: [reveal(personId, later)] });
    const actions: AclAction[] = ['read', 'write', 'admin'];
    for (const action of actions) expect(can(everything, action, open, at)).toBe(false);
  });

  it('never answers a capability on an area, the org or a row', () => {
    const everything = holding(org('admin'), area('admin', '20-29'));
    const capabilities: CredentialCapability[] = ['see', 'use', 'reveal', 'manage'];
    for (const capability of capabilities) {
      expect(can(everything, capability, { kind: 'area', area: '20-29' }, at)).toBe(false);
      expect(can(everything, capability, { kind: 'org' }, at)).toBe(false);
      const row = { kind: 'row', table: 'delegations', area: '20-29', ownerId: personId } as const;
      expect(can(everything, capability, row, at)).toBe(false);
    }
  });

  it('ignores an expired grant on the credential area', () => {
    const lapsed = { ...area('admin', '20-29'), expiresAt: '2026-09-01T00:00:00.000Z' };
    expect(can(holding(lapsed), 'see', finance(), at)).toBe(false);
    expect(can(holding(lapsed), 'use', inMonthlyClose, at)).toBe(false);
    expect(can(holding(lapsed), 'manage', finance(), at)).toBe(false);
  });

  it('declares that only use is open to an agent and that no org admin uses', () => {
    expect(credentialRules.use).toEqual({ area: 'editor', orgAdmin: false, person: false });
    expect(credentialRules.see).toEqual({ area: 'viewer', orgAdmin: true, person: true });
    expect(credentialRules.reveal).toEqual({ area: 'viewer', orgAdmin: true, person: true });
    expect(credentialRules.manage).toEqual({ area: 'admin', orgAdmin: true, person: true });
  });
});

describe('#156 use applies only where the credential is bound', () => {
  const editor = holding(area('editor', '20-29'));

  it('refuses a use that names no workflow and connector', () => {
    expect(can(editor, 'use', finance(), at)).toBe(false);
  });

  it('refuses a use from a workflow the credential is not bound to', () => {
    expect(can(editor, 'use', finance({ usedBy: elsewhere }), at)).toBe(false);
  });

  it('refuses a use from another connector of the bound workflow', () => {
    expect(can(editor, 'use', finance({ usedBy: otherConnector }), at)).toBe(false);
  });

  it('refuses every use of a credential with no binding', () => {
    expect(can(editor, 'use', finance({ bindings: [], usedBy: monthlyClose }), at)).toBe(false);
  });

  it('allows a use from any one of several bindings', () => {
    const twice = finance({ bindings: [monthlyClose, elsewhere], usedBy: elsewhere });
    expect(can(editor, 'use', twice, at)).toBe(true);
  });
});

describe('#156 reveal needs a live reveal grant on that one credential for that person', () => {
  const admin = holding(area('admin', '20-29'));

  it('refuses a reveal grant that has expired', () => {
    expect(can(admin, 'reveal', finance({ revealGrants: [reveal(personId, earlier)] }), at)).toBe(
      false,
    );
  });

  it('refuses a reveal grant that expires at exactly that instant', () => {
    const now = finance({ revealGrants: [reveal(personId, at.toISOString())] });
    expect(can(admin, 'reveal', now, at)).toBe(false);
  });

  it('refuses a reveal grant given to someone else', () => {
    const theirs = finance({ revealGrants: [reveal(otherPersonId, later)] });
    expect(can(admin, 'reveal', theirs, at)).toBe(false);
  });

  it('refuses a reveal grant given on another credential', () => {
    const misplaced = finance({ revealGrants: [reveal(personId, later, otherCredentialId)] });
    expect(can(admin, 'reveal', misplaced, at)).toBe(false);
  });

  it('refuses a reveal grant whose expiry is not an instant', () => {
    const endless = finance({ revealGrants: [reveal(personId, 'never')] });
    expect(can(admin, 'reveal', endless, at)).toBe(false);
  });

  it('gives a reveal grant no other capability', () => {
    expect(can(holding(), 'see', revealable, at)).toBe(false);
    expect(can(holding(), 'manage', revealable, at)).toBe(false);
    expect(can(holding(), 'use', { ...revealable, usedBy: monthlyClose }, at)).toBe(false);
  });
});

describe('#156 an agent uses a credential and passes no other capability', () => {
  const everything = [org('admin'), area('admin', '20-29')];
  const open = finance({ usedBy: monthlyClose, revealGrants: [reveal(personId, later)] });

  it.each([false, true])('never reveals, sees or manages (interactive: %s)', (interactive) => {
    const bound = agent(interactive, ...everything);
    expect(can(bound, 'reveal', open, at)).toBe(false);
    expect(can(bound, 'see', open, at)).toBe(false);
    expect(can(bound, 'manage', open, at)).toBe(false);
  });

  it('uses a bound credential with its person editor grant on the area', () => {
    expect(can(agent(false, area('editor', '20-29')), 'use', inMonthlyClose, at)).toBe(true);
  });

  it('cannot use a credential of another area or an unbound one', () => {
    expect(can(agent(false, area('editor', '80-89')), 'use', inMonthlyClose, at)).toBe(false);
    expect(can(agent(false, area('editor', '20-29')), 'use', finance(), at)).toBe(false);
  });

  it('cannot use with no grants, as a service token or the system has none', () => {
    expect(can(agent(false), 'use', inMonthlyClose, at)).toBe(false);
  });

  it('refuses reveal, see and manage to a person principal lent to a delegation', () => {
    const approver = lent(...everything);
    expect(can(approver, 'reveal', open, at)).toBe(false);
    expect(can(approver, 'see', open, at)).toBe(false);
    expect(can(approver, 'manage', open, at)).toBe(false);
    expect(can(approver, 'use', open, at)).toBe(true);
  });
});
