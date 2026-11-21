import { describe, expect, it } from 'vitest';
import { identitySchema } from '@uw/contracts';
import { personPrincipal, type Grant } from '@uw/core/principal';
import { readsPerson } from './reading.ts';

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

describe('#208 who may open a person page', () => {
  it('lets anyone who can read an area open an active colleague', () => {
    expect(readsPerson(reader([areaViewer]), { personId: blair, status: 'active' }, at)).toBe(true);
  });

  it('keeps a reader with no live grant to their own page', () => {
    expect(readsPerson(reader([]), { personId: blair, status: 'active' }, at)).toBe(false);
    expect(readsPerson(reader([lapsed]), { personId: blair, status: 'active' }, at)).toBe(false);
    expect(readsPerson(reader([]), { personId: avery, status: 'active' }, at)).toBe(true);
  });

  it('shows a pending or declined person only to an org admin and to themself', () => {
    for (const status of ['pending', 'disabled'] as const) {
      const person = { personId: blair, status };
      expect(readsPerson(reader([areaViewer]), person, at)).toBe(false);
      expect(readsPerson(reader([orgAdmin]), person, at)).toBe(true);
      expect(readsPerson(reader([]), { personId: avery, status }, at)).toBe(true);
    }
  });

  it('leaves a person whose status the caller did not read to the page to decide', () => {
    expect(readsPerson(reader([areaViewer]), { personId: blair, status: null }, at)).toBe(true);
  });

  it('never lets an agent open a person page', () => {
    const identity = identitySchema.parse('agent:builder');
    const agent = { ...reader([orgAdmin]), kind: 'agent' as const, identity };
    expect(readsPerson(agent, { personId: blair, status: 'active' }, at)).toBe(false);
  });
});
