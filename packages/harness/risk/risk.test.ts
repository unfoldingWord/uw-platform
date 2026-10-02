import { principalSchema, type JdArea, type Principal, type Role } from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import { applyDeclaration, domainOf, floorFromPaths } from './derive.ts';
import { approverCovers, domainGrants, requiredResources } from './domain-grants.ts';
import { protectedDirectories } from './protected-directories.ts';

const at = new Date('2026-10-01T00:00:00.000Z');
const personId = '00000000-0000-4000-8000-000000000a01';

type Held = {
  readonly role: Role;
  readonly area: JdArea | null;
  readonly expiresAt?: string | null;
};

function approver(...held: readonly Held[]): Principal {
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email: 'approver@unfoldingword.org',
    interactive: true,
    grants: held.map((grant, index) => ({
      grantId: `00000000-0000-4000-8000-00000000b0${index}1`,
      role: grant.role,
      scopeKind: grant.area === null ? 'org' : 'jd_area',
      scopeArea: grant.area,
      expiresAt: grant.expiresAt ?? null,
    })),
  });
}

describe('KN-17 the protected-directory map', () => {
  it('lists every protected path once and no entry is a prefix of another', () => {
    const paths = protectedDirectories.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const left of paths) {
      for (const right of paths) {
        if (left !== right) expect(right.startsWith(left)).toBe(false);
      }
    }
  });

  it('maps each path to one domain by exact segment prefix', () => {
    expect(domainOf('packages/db/migrations/0009_x.sql')).toBe('migration');
    expect(domainOf('packages/core/acl.ts')).toBe('acl');
    expect(domainOf('apps/uw-app/acl/grants.ts')).toBe('acl');
    expect(domainOf('.github/workflows/ci.yml')).toBe('infra');
    expect(domainOf('packages/ledger/post.ts')).toBe('ledger');
  });

  it('does not match a sibling that only shares a name prefix', () => {
    expect(domainOf('infrastructure-notes.md')).toBeNull();
    expect(domainOf('packages/core/acl.test.ts')).toBeNull();
    expect(domainOf('packages/core/acl.ts.bak')).toBeNull();
    expect(domainOf('packages/db/migrations-notes.md')).toBeNull();
    expect(domainOf('docs/infra/x.md')).toBeNull();
  });

  it('is robust to ./ prefixes, backslashes, doubled slashes and dot segments', () => {
    expect(domainOf('./infra/x.json')).toBe('infra');
    expect(domainOf('.\\infra\\x.json')).toBe('infra');
    expect(domainOf('packages\\db\\migrations\\0009_x.sql')).toBe('migration');
    expect(domainOf('infra//x.json')).toBe('infra');
    expect(domainOf('./packages/core/acl.ts')).toBe('acl');
    expect(domainOf('docs/../infra/x.json')).toBe('infra');
  });
});

describe('KN-17 the floor from paths', () => {
  it('has no tier and no domain for an unprotected path', () => {
    expect(floorFromPaths(['apps/uw-app/board.tsx'])).toEqual({ tier: null, domains: [] });
    expect(floorFromPaths([])).toEqual({ tier: null, domains: [] });
  });

  it('floors at high with the touched domains in schema order without duplicates', () => {
    const floor = floorFromPaths([
      'packages/db/migrations/0009_x.sql',
      'infra/uw-app/wrangler.toml',
      './infra/x.json',
    ]);
    expect(floor).toEqual({ tier: 'high', domains: ['infra', 'migration'] });
  });

  it('treats the acl file as exact and its test file as unprotected', () => {
    expect(floorFromPaths(['packages/core/acl.ts'])).toEqual({ tier: 'high', domains: ['acl'] });
    expect(floorFromPaths(['packages/core/acl.test.ts'])).toEqual({ tier: null, domains: [] });
  });
});

describe('KN-17 the declaration raises and never lowers', () => {
  const high = floorFromPaths(['packages/db/migrations/0009_x.sql']);

  it('keeps a high floor and its domains under a low declaration', () => {
    const result = applyDeclaration(high, { riskTier: 'low', riskDomains: [] });
    expect(result).toEqual({ ok: true, tier: 'high', domains: ['migration'] });
  });

  it('adds a declared domain and raises a missing tier', () => {
    const result = applyDeclaration(high, { riskTier: 'high', riskDomains: ['ledger'] });
    expect(result).toEqual({ ok: true, tier: 'high', domains: ['ledger', 'migration'] });
    const none = floorFromPaths(['apps/uw-app/board.tsx']);
    expect(applyDeclaration(none, { riskTier: 'standard', riskDomains: [] })).toEqual({
      ok: true,
      tier: 'standard',
      domains: [],
    });
  });

  it('refuses with risk_tier_undeclared when there is no declaration', () => {
    expect(applyDeclaration(high, null)).toEqual({
      ok: false,
      reason: 'risk_tier_undeclared',
      domains: ['migration'],
    });
  });
});

describe('KN-17 the domain-to-grant map', () => {
  it('names the grant each domain needs in one place', () => {
    expect(domainGrants.get('ledger')).toEqual({ kind: 'area', area: '20-29' });
    for (const domain of ['acl', 'infra', 'migration'] as const) {
      expect(domainGrants.get(domain)).toEqual({ kind: 'org' });
    }
  });

  it('lists the harness area first, then each domain resource', () => {
    expect(requiredResources('80-89', [])).toEqual([{ kind: 'area', area: '80-89' }]);
    expect(requiredResources('80-89', ['ledger', 'acl'])).toEqual([
      { kind: 'area', area: '80-89' },
      { kind: 'area', area: '20-29' },
      { kind: 'org' },
    ]);
  });

  it('lets an area admin cover no domain and an org admin cover org domains', () => {
    const areaAdmin = approver({ role: 'admin', area: '80-89' });
    expect(approverCovers(areaAdmin, '80-89', [], at)).toBe(true);
    expect(approverCovers(areaAdmin, '80-89', ['acl'], at)).toBe(false);
    const orgAdmin = approver({ role: 'admin', area: null });
    expect(approverCovers(orgAdmin, '80-89', ['acl', 'infra'], at)).toBe(true);
    expect(approverCovers(orgAdmin, '80-89', ['ledger'], at)).toBe(true);
  });

  it('needs admin on 20-29 as well as the area for ledger, held by one approver', () => {
    const both = approver({ role: 'admin', area: '80-89' }, { role: 'admin', area: '20-29' });
    expect(approverCovers(both, '80-89', ['ledger'], at)).toBe(true);
    expect(approverCovers(both, '80-89', ['ledger', 'acl'], at)).toBe(false);
    const areaOnly = approver({ role: 'admin', area: '80-89' });
    expect(approverCovers(areaOnly, '80-89', ['ledger'], at)).toBe(false);
    const ledgerOnly = approver({ role: 'admin', area: '20-29' });
    expect(approverCovers(ledgerOnly, '80-89', ['ledger'], at)).toBe(false);
  });

  it('does not count an expired grant', () => {
    const expired = approver({ role: 'admin', area: null, expiresAt: '2026-09-30T00:00:00.000Z' });
    expect(approverCovers(expired, '80-89', ['acl'], at)).toBe(false);
    const live = approver({ role: 'admin', area: null, expiresAt: '2026-10-02T00:00:00.000Z' });
    expect(approverCovers(live, '80-89', ['acl'], at)).toBe(true);
  });
});
