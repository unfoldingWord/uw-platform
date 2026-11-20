import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { principalSchema } from '../../packages/contracts/index.ts';
import { can, rowReadRules, type RestrictedTable } from '../../packages/core/acl.ts';
import { classifiedTables } from '../../packages/db/declarations.ts';
import * as schema from '../../packages/db/schema.ts';

const at = new Date('2026-10-01T12:00:00.000Z');
const areas = Array.from({ length: 10 }, (_, digit) => `${String(digit)}0-${String(digit)}9`);
const viewerId = '00000000-0000-4000-8000-000000000a01';
const otherId = '00000000-0000-4000-8000-000000000a02';
const closed: ReadonlySet<string> = new Set(['restricted', 'sensitive']);

type Classified = { readonly table: string; readonly classification: string };
type DeclaredRule = { readonly area: string | null; readonly owner: boolean };

function withoutReadRule(
  tables: readonly Classified[],
  rules: Readonly<Record<string, DeclaredRule>>,
): string[] {
  const declared = new Map(Object.entries(rules));
  return tables
    .filter((entry) => closed.has(entry.classification))
    .filter((entry) => {
      const rule = declared.get(entry.table);
      return rule === undefined || (rule.area === null && !rule.owner);
    })
    .map((entry) => entry.table);
}

function rulesWithoutTable(
  tables: readonly Classified[],
  rules: Readonly<Record<string, DeclaredRule>>,
): string[] {
  const named = new Set(
    tables.filter((entry) => closed.has(entry.classification)).map((entry) => entry.table),
  );
  return Object.keys(rules).filter((table) => !named.has(table));
}

describe('#155 every restricted or sensitive table declares who reads its rows', () => {
  const tables = classifiedTables(schema);

  it('finds a read rule naming an area role, an owner or both for each such table', () => {
    expect(tables.filter((entry) => closed.has(entry.classification)).length).toBeGreaterThan(0);
    expect(withoutReadRule(tables, rowReadRules)).toEqual([]);
  });

  it('holds no read rule for a table that is not restricted or sensitive, or is gone', () => {
    expect(rulesWithoutTable(tables, rowReadRules)).toEqual([]);
  });

  it('reports a new sensitive table that lands without a rule, or with an empty one', () => {
    const landed = [...tables, { table: 'credentials', classification: 'sensitive' }];
    expect(withoutReadRule(landed, rowReadRules)).toEqual(['credentials']);
    const empty = { ...rowReadRules, credentials: { area: null, owner: false } };
    expect(withoutReadRule(landed, empty)).toEqual(['credentials']);
  });

  it('reports a rule left behind for a table that became internal', () => {
    const opened = tables.map((entry) =>
      entry.table === 'delegations' ? { ...entry, classification: 'internal' } : entry,
    );
    expect(rulesWithoutTable(opened, rowReadRules)).toEqual(['delegations']);
  });
});

type HeldGrant = { role: string; scope: string; expiresAt: string | null };

const grantArb = fc.record({
  role: fc.constantFrom('admin', 'editor', 'viewer'),
  scope: fc.constantFrom('org', ...areas),
  expiresAt: fc.constantFrom(
    '2026-09-01T00:00:00.000Z',
    at.toISOString(),
    '2027-01-01T00:00:00.000Z',
    null,
  ),
});

function holding(held: readonly HeldGrant[], kind: 'person' | 'agent') {
  return principalSchema.parse({
    identity: kind === 'person' ? `human:${viewerId}` : `agent:${viewerId}/laptop`,
    kind,
    personId: viewerId,
    email: kind === 'person' ? 'p@unfoldingword.org' : null,
    grants: held.map((grant, index) => ({
      grantId: `00000000-0000-4000-8000-0000000000${String(index + 10)}`,
      role: grant.role,
      scopeKind: grant.scope === 'org' ? 'org' : 'jd_area',
      scopeArea: grant.scope === 'org' ? null : grant.scope,
      expiresAt: grant.expiresAt,
    })),
    interactive: kind === 'person',
  });
}

const ranks = new Map([
  ['viewer', 1],
  ['editor', 2],
  ['admin', 3],
]);

const written = new Map<string, { areaRank: number | null; owner: boolean }>([
  ['role_grants', { areaRank: 3, owner: true }],
  ['grant_audit', { areaRank: 3, owner: true }],
  ['person_audit', { areaRank: null, owner: true }],
  ['service_tokens', { areaRank: null, owner: true }],
  ['push_subscriptions', { areaRank: null, owner: true }],
  ['delegations', { areaRank: 1, owner: true }],
  ['routines', { areaRank: 1, owner: true }],
  ['gate_decisions', { areaRank: 1, owner: false }],
]);

type Asked = {
  readonly table: string;
  readonly area: string | null;
  readonly ownerId: string | null;
  readonly kind: 'person' | 'agent';
};

function oracle(held: readonly HeldGrant[], asked: Asked): boolean {
  const rule = written.get(asked.table);
  if (rule === undefined) return false;
  if (rule.owner && asked.kind === 'person' && asked.ownerId === viewerId) return true;
  return held
    .filter((grant) => grant.expiresAt === null || grant.expiresAt > at.toISOString())
    .some((grant) => {
      const rank = ranks.get(grant.role) ?? 0;
      if (grant.scope === 'org') return rank === 3;
      if (rule.areaRank === null || asked.area === null) return false;
      return grant.scope === asked.area && rank >= rule.areaRank;
    });
}

const tableNames = Object.keys(rowReadRules) as RestrictedTable[];

const askedArb = fc.record({
  table: fc.constantFrom(...tableNames),
  area: fc.constantFrom(null, ...areas),
  ownerId: fc.constantFrom(null, viewerId, otherId),
  kind: fc.constantFrom('person' as const, 'agent' as const),
});

describe('#155 can() reads a restricted row only by its declared rule', () => {
  it('writes the rule down for every table that has one', () => {
    expect([...written.keys()].sort()).toEqual([...tableNames].sort());
  });

  it('matches an independent oracle over grant sets, tables, areas, owners and kinds', () => {
    fc.assert(
      fc.property(fc.array(grantArb, { maxLength: 5 }), askedArb, (held, asked) => {
        const { table, area, ownerId } = asked;
        const resource = { kind: 'row', table, area, ownerId } as const;
        const principal = holding(held, asked.kind);
        expect(can(principal, 'read', resource, at)).toBe(oracle(held, asked));
        expect(can(principal, 'write', resource, at)).toBe(false);
        expect(can(principal, 'admin', resource, at)).toBe(false);
      }),
      { numRuns: 2000 },
    );
  });

  it('never lets an org viewer or org editor read a row without a grant on its area', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('viewer', 'editor'),
        fc.constantFrom(...tableNames),
        fc.constantFrom(null, ...areas),
        (role, table, area) => {
          const principal = holding([{ role, scope: 'org', expiresAt: null }], 'person');
          const resource = { kind: 'row', table, area, ownerId: otherId } as const;
          expect(can(principal, 'read', resource, at)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});
