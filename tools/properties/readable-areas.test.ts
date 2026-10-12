import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { principalSchema } from '../../packages/contracts/index.ts';
import { can, readableAreas, type AclResource } from '../../packages/core/acl.ts';

const at = new Date('2026-10-01T12:00:00.000Z');
const areas = Array.from({ length: 10 }, (_, digit) => `${String(digit)}0-${String(digit)}9`);
const expiries = fc.constantFrom(
  '2026-09-01T00:00:00.000Z',
  at.toISOString(),
  '2027-01-01T00:00:00.000Z',
  null,
);

type HeldGrant = { role: string; scope: string; expiresAt: string | null };

const grantArb = fc.record({
  role: fc.constantFrom('admin', 'editor', 'viewer'),
  scope: fc.constantFrom('org', ...areas),
  expiresAt: expiries,
});

function holding(held: readonly HeldGrant[]) {
  return principalSchema.parse({
    identity: 'human:00000000-0000-4000-8000-000000000a01',
    kind: 'person',
    personId: '00000000-0000-4000-8000-000000000a01',
    email: 'p@unfoldingword.org',
    grants: held.map((grant, index) => ({
      grantId: `00000000-0000-4000-8000-0000000000${String(index + 10)}`,
      role: grant.role,
      scopeKind: grant.scope === 'org' ? 'org' : 'jd_area',
      scopeArea: grant.scope === 'org' ? null : grant.scope,
      expiresAt: grant.expiresAt,
    })),
    interactive: true,
  });
}

describe('readableAreas agrees with can(read) for every grant set and area', () => {
  it('lists an area exactly when can() lets the principal read it', () => {
    fc.assert(
      fc.property(fc.array(grantArb, { maxLength: 5 }), (held) => {
        const principal = holding(held);
        const readable = readableAreas(principal, at);
        for (const area of areas) {
          const listed = readable.kind === 'all' || readable.areas.includes(area);
          expect(listed).toBe(can(principal, 'read', { kind: 'area', area }, at));
        }
      }),
      { numRuns: 300 },
    );
  });
});

const ranks = new Map([
  ['viewer', 1],
  ['editor', 2],
  ['admin', 3],
]);
const needed = new Map([
  ['read', 1],
  ['write', 2],
  ['admin', 3],
]);
const resourceArb = fc.constantFrom(
  { kind: 'org' } as const,
  ...areas.map((area) => ({ kind: 'area', area }) as const),
);

function oracle(held: readonly HeldGrant[], action: string, resource: AclResource): boolean {
  return held
    .filter((grant) => grant.expiresAt === null || grant.expiresAt > at.toISOString())
    .some((grant) => {
      const rank = ranks.get(grant.role) ?? 0;
      const need = needed.get(action) ?? 99;
      if (grant.scope === 'org') return rank >= need;
      if (resource.kind === 'org') return false;
      if (grant.scope === resource.area) return rank >= need;
      return action === 'read' && rank >= 2;
    });
}

describe('can() agrees with the written rule for every action and resource', () => {
  it('matches an independent oracle over grant sets, actions and resources', () => {
    fc.assert(
      fc.property(
        fc.array(grantArb, { maxLength: 5 }),
        fc.constantFrom('read', 'write', 'admin'),
        resourceArb,
        (held, action, resource) => {
          expect(can(holding(held), action, resource, at)).toBe(oracle(held, action, resource));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('lets an area editor read every area yet refuses it the org', () => {
    const principal = holding([{ role: 'editor', scope: '80-89', expiresAt: null }]);
    expect(readableAreas(principal, at)).toEqual({ kind: 'all' });
    expect(can(principal, 'read', { kind: 'org' }, at)).toBe(false);
  });
});
