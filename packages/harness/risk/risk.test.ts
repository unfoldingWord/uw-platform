import {
  principalSchema,
  riskDomainSchema,
  riskTierSchema,
  type JdArea,
  type Principal,
  type RiskDeclaration,
  type RiskDomain,
  type RiskTier,
  type Role,
} from '@uw/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyDeclaration,
  carryForward,
  domainOf,
  floorFromPaths,
  type RiskFloor,
} from './derive.ts';
import { approverCovers, domainGrants, requiredResources, resourcesFrom } from './domain-grants.ts';
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
});

describe('KN-17 the protected-directory map is robust and protects itself', () => {
  it('protects the risk map itself under acl', () => {
    expect(domainOf('packages/harness/risk/protected-directories.ts')).toBe('acl');
    expect(domainOf('packages/harness/risk-notes.md')).toBeNull();
  });

  it('protects the ship rule under acl', () => {
    expect(domainOf('packages/harness/ship-rule.ts')).toBe('acl');
    expect(domainOf('packages/harness/ship-rule.test.ts')).toBeNull();
  });

  it('protects the GitHub identity and merge code under acl', () => {
    expect(domainOf('packages/harness/github/reviewers.ts')).toBe('acl');
    expect(domainOf('apps/uw-app/github/merge.ts')).toBe('acl');
  });
});

describe('KN-17 the protected-directory map covers the code that decides what Ship sees and what merges', () => {
  it('protects the whole GitHub module under acl: the App client, the merge and the ship writes', () => {
    for (const file of ['client.ts', 'merge.ts', 'ship-writes.ts', 'session.ts', 'deps.ts']) {
      expect(domainOf(`apps/uw-app/github/${file}`)).toBe('acl');
    }
    expect(domainOf('apps/uw-app/github/facts/upsert.ts')).toBe('acl');
  });

  it('protects every platform adapter under acl, the connectors and the GitHub facts among them', () => {
    expect(domainOf('apps/uw-app/ports/connectors.ts')).toBe('acl');
    expect(domainOf('apps/uw-app/ports/github-facts.ts')).toBe('acl');
    expect(domainOf('apps/uw-app/ports/grants.ts')).toBe('acl');
  });

  it('protects the kernel composition root under acl', () => {
    expect(domainOf('apps/uw-app/kernel.ts')).toBe('acl');
    expect(domainOf('apps/uw-app/kernel.test.ts')).toBeNull();
  });

  it('protects the ship rule contract (CI jobs and refusals) under acl', () => {
    expect(domainOf('packages/contracts/ship-rule.ts')).toBe('acl');
    expect(domainOf('packages/contracts/ship-rule.test.ts')).toBeNull();
  });
});

describe('KN-17 the protected-directory map covers the checks and the CI that enforce the rules', () => {
  it('protects the dependency rules and the architecture checks under infra', () => {
    expect(domainOf('.dependency-cruiser.mjs')).toBe('infra');
    expect(domainOf('tools/architecture/connector-callers.test.ts')).toBe('infra');
    expect(domainOf('tools/architecture/github-rules.test.ts')).toBe('infra');
  });

  it('protects all of .github under infra: workflows, issue templates and actions', () => {
    expect(domainOf('.github/workflows/ci.yml')).toBe('infra');
    expect(domainOf('.github/ISSUE_TEMPLATE/task.yml')).toBe('infra');
    expect(domainOf('.github/actions/setup/action.yml')).toBe('infra');
  });

  it('protects infra under infra', () => {
    expect(domainOf('infra/github/app-manifest.json')).toBe('infra');
  });

  it('protects the gate decision path that assembles and applies the ship rule under acl', () => {
    expect(domainOf('packages/harness/gates/ship-input.ts')).toBe('acl');
    expect(domainOf('packages/harness/gates/exit.ts')).toBe('acl');
  });

  it('keeps every entry in normalised form and round-trips through domainOf', () => {
    for (const entry of protectedDirectories) {
      expect(entry.path).toBe(entry.path.toLowerCase());
      expect(entry.path).not.toMatch(/\\|\/\/|^\.?\/|(^|\/)\.{1,2}(\/|$)/u);
      expect(domainOf(entry.path)).toBe(entry.domain);
    }
  });

  it('matches the bare directory, a trailing slash on a file, and any letter case', () => {
    expect(domainOf('infra')).toBe('infra');
    expect(domainOf('packages/ledger')).toBe('ledger');
    expect(domainOf('packages/core/acl.ts/')).toBe('acl');
    expect(domainOf('Infra/X.json')).toBe('infra');
    expect(domainOf('PACKAGES/Core/ACL.ts')).toBe('acl');
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

const tiers: readonly (RiskTier | null)[] = [null, ...riskTierSchema.options];
const domainSubsets = riskDomainSchema.options.reduce<RiskDomain[][]>(
  (subsets, domain) => [...subsets, ...subsets.map((subset) => [...subset, domain])],
  [[]],
);

function everyCase(): readonly (readonly [RiskFloor, RiskDeclaration])[] {
  const cases: (readonly [RiskFloor, RiskDeclaration])[] = [];
  for (const tier of tiers) {
    for (const domains of domainSubsets) {
      for (const riskTier of riskTierSchema.options) {
        for (const riskDomains of domainSubsets) {
          cases.push([
            { tier, domains },
            { riskTier, riskDomains },
          ]);
        }
      }
    }
  }
  return cases;
}

function assertNeverLowers(floor: RiskFloor, declaration: RiskDeclaration): void {
  const result = applyDeclaration(floor, declaration);
  if (!result.ok) throw new Error('a declaration was refused');
  const rank = riskTierSchema.options.indexOf(result.tier);
  expect(rank).toBeGreaterThanOrEqual(riskTierSchema.options.indexOf(declaration.riskTier));
  if (floor.tier !== null) {
    expect(rank).toBeGreaterThanOrEqual(riskTierSchema.options.indexOf(floor.tier));
  }
  for (const domain of [...floor.domains, ...declaration.riskDomains]) {
    expect(result.domains).toContain(domain);
  }
}

describe('KN-17 applyDeclaration never lowers a tier or removes a domain', () => {
  it('holds over every floor, declared tier and domain subset', () => {
    for (const [floor, declaration] of everyCase()) assertNeverLowers(floor, declaration);
  });

  it('carries a previous derivation forward as a floor: tier never lower, domains a union', () => {
    const carried = carryForward(
      { tier: null, domains: ['infra'] },
      { tier: 'high', domains: ['migration'] },
    );
    expect(carried).toEqual({ tier: 'high', domains: ['infra', 'migration'] });
    expect(carryForward({ tier: 'high', domains: [] }, { tier: null, domains: [] }).tier).toBe(
      'high',
    );
    expect(carryForward({ tier: null, domains: [] }, { tier: null, domains: [] }).tier).toBeNull();
  });
});

describe('KN-17 the domain-to-grant map fails closed', () => {
  it('covers every risk domain and nothing else', () => {
    expect([...domainGrants.keys()].toSorted()).toEqual(riskDomainSchema.options.toSorted());
    expect(domainGrants.size).toBe(riskDomainSchema.options.length);
  });

  it('treats a domain with no mapped resource as uncovered', () => {
    const partial = new Map(domainGrants);
    partial.delete('infra');
    expect(resourcesFrom(partial, '80-89', ['acl', 'infra'])).toBeNull();
    expect(resourcesFrom(partial, '80-89', ['acl'])).toEqual([
      { kind: 'area', area: '80-89' },
      { kind: 'org' },
    ]);
  });
});
