import { describe, expect, it } from 'vitest';
import { identitySchema, type Grant, type PersonStatus } from '@uw/contracts';
import { can } from './acl.ts';
import { personPrincipal } from './principal.ts';

const at = new Date('2026-11-21T12:00:00.000Z');
const avery = '00000000-0000-4000-8000-0000000000a1';
const blair = '00000000-0000-4000-8000-0000000000a2';

function reader(grants: readonly Grant[]) {
  return personPrincipal({
    personId: avery,
    email: 'avery.stone@unfoldingword.org',
    grants,
    interactive: true,
  });
}

function person(personId: string, status: PersonStatus) {
  return { kind: 'person' as const, personId, status };
}

const areaViewer: Grant = {
  grantId: '00000000-0000-4000-8000-0000000000b1',
  role: 'viewer',
  scopeKind: 'jd_area',
  scopeArea: '80-89',
  expiresAt: null,
};
const orgAdmin: Grant = {
  grantId: '00000000-0000-4000-8000-0000000000b2',
  role: 'admin',
  scopeKind: 'org',
  scopeArea: null,
  expiresAt: null,
};
const lapsed: Grant = { ...areaViewer, expiresAt: '2026-11-01T00:00:00.000Z' };

describe('#208 can() reads a person page by the directory rule', () => {
  it('lets anyone who can read an area open an active colleague', () => {
    expect(can(reader([areaViewer]), 'read', person(blair, 'active'), at)).toBe(true);
  });

  it('keeps a reader with no live grant to their own page', () => {
    expect(can(reader([]), 'read', person(blair, 'active'), at)).toBe(false);
    expect(can(reader([lapsed]), 'read', person(blair, 'active'), at)).toBe(false);
    expect(can(reader([]), 'read', person(avery, 'active'), at)).toBe(true);
  });

  it('shows a pending or declined person only to an org admin and to themself', () => {
    for (const status of ['pending', 'disabled'] as const) {
      expect(can(reader([areaViewer]), 'read', person(blair, status), at)).toBe(false);
      expect(can(reader([orgAdmin]), 'read', person(blair, status), at)).toBe(true);
      expect(can(reader([]), 'read', person(avery, status), at)).toBe(true);
    }
  });

  it('answers only read on a person page', () => {
    for (const action of ['write', 'admin'] as const) {
      expect(can(reader([orgAdmin]), action, person(blair, 'active'), at)).toBe(false);
    }
  });

  it('never lets an agent open a person page', () => {
    const identity = identitySchema.parse('agent:builder');
    const agent = { ...reader([orgAdmin]), kind: 'agent' as const, identity };
    expect(can(agent, 'read', person(blair, 'active'), at)).toBe(false);
  });
});
