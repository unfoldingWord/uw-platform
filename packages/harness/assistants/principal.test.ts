import { assistantIdentityOf, identitySchema, type Grant } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import type { Delegation } from '../ports.ts';
import { assistantPrincipal } from './principal.ts';

const personId = '00000000-0000-4000-8000-000000000105';
const at = new Date('2026-10-01T09:00:00.000Z');
const delegationExpiry = new Date('2026-12-30T09:00:00.000Z');

const delegation: Delegation = {
  id: '00000000-0000-4000-8000-0000000000d1',
  personId,
  persona: identitySchema.parse(assistantIdentityOf(personId)),
  harnessId: '00000000-0000-4000-8000-0000000000a1',
  capability: 'assist',
  maxTier: null,
  grantedAt: at,
  expiresAt: delegationExpiry,
  revokedAt: null,
  lapsedAt: null,
  supersedes: null,
};

const editor: Grant = {
  grantId: '00000000-0000-4000-8000-0000000000e1',
  role: 'editor',
  scopeKind: 'jd_area',
  scopeArea: '10-19',
  expiresAt: null,
};
const admin: Grant = {
  grantId: '00000000-0000-4000-8000-0000000000e2',
  role: 'admin',
  scopeKind: 'org',
  scopeArea: null,
  expiresAt: '2026-11-01T09:00:00.000Z',
};
const expired: Grant = {
  ...editor,
  grantId: '00000000-0000-4000-8000-0000000000e3',
  expiresAt: '2026-09-01T09:00:00.000Z',
};

describe('PA-2 the assistant principal reads only what its person reads', () => {
  it('names the assistant as a non-interactive agent bound to its person', () => {
    const principal = assistantPrincipal(delegation, [editor], at);
    expect(principal).toMatchObject({
      identity: assistantIdentityOf(personId),
      kind: 'agent',
      personId,
      email: null,
      interactive: false,
    });
  });

  it('clamps every grant to viewer, keeping its scope', () => {
    const principal = assistantPrincipal(delegation, [editor, admin], at);
    expect(principal.grants.map((grant) => grant.role)).toEqual(['viewer', 'viewer']);
    expect(principal.grants.map((grant) => grant.scopeArea)).toEqual(['10-19', null]);
  });

  it('ends each grant at the earlier of its own and the delegation expiry', () => {
    const principal = assistantPrincipal(delegation, [editor, admin], at);
    expect(principal.grants.map((grant) => grant.expiresAt)).toEqual([
      delegationExpiry.toISOString(),
      '2026-11-01T09:00:00.000Z',
    ]);
  });

  it('drops a grant that has already expired', () => {
    expect(assistantPrincipal(delegation, [expired], at).grants).toEqual([]);
  });
});
