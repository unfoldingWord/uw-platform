import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { principalSchema } from '../../packages/contracts/index.ts';
import { can } from '../../packages/core/acl.ts';

const at = new Date('2026-10-01T12:00:00.000Z');
const areas = Array.from({ length: 10 }, (_, digit) => `${String(digit)}0-${String(digit)}9`);
const actorId = '00000000-0000-4000-8000-000000000a01';
const otherId = '00000000-0000-4000-8000-000000000a02';
const credentialId = '00000000-0000-4000-8000-00000000c001';
const otherCredentialId = '00000000-0000-4000-8000-00000000c002';
const capabilities = ['see', 'use', 'reveal', 'manage'] as const;
const instants = ['2026-09-01T00:00:00.000Z', at.toISOString(), '2027-01-01T00:00:00.000Z'];

type HeldGrant = { role: string; scope: string; expiresAt: string | null };
type Kind = 'person' | 'agent';
type Binding = { harnessId: string; connectorKey: string };
type Reveal = { credentialId: string; personId: string; expiresAt: string };
type Asked = {
  readonly capability: (typeof capabilities)[number];
  readonly area: string;
  readonly bindings: Binding[];
  readonly usedBy: Binding | null;
  readonly revealGrants: Reveal[];
  readonly kind: Kind;
  readonly interactive: boolean;
};

const grantArb = fc.record({
  role: fc.constantFrom('admin', 'editor', 'viewer'),
  scope: fc.constantFrom('org', ...areas),
  expiresAt: fc.constantFrom(...instants, null),
});

const bindingArb = fc.record({
  harnessId: fc.constantFrom('h1', 'h2'),
  connectorKey: fc.constantFrom('bank-export', 'funder-portal'),
});

const revealArb = fc.record({
  credentialId: fc.constantFrom(credentialId, otherCredentialId),
  personId: fc.constantFrom(actorId, otherId),
  expiresAt: fc.constantFrom(...instants),
});

const askedArb = fc.record({
  capability: fc.constantFrom(...capabilities),
  area: fc.constantFrom(...areas),
  bindings: fc.array(bindingArb, { maxLength: 3 }),
  usedBy: fc.option(bindingArb, { nil: null }),
  revealGrants: fc.array(revealArb, { maxLength: 3 }),
  kind: fc.constantFrom('person' as const, 'agent' as const),
  interactive: fc.boolean(),
});

function holding(held: readonly HeldGrant[], kind: Kind, interactive: boolean) {
  return principalSchema.parse({
    identity: kind === 'person' ? `human:${actorId}` : `agent:${actorId}/laptop`,
    kind,
    personId: actorId,
    email: kind === 'person' ? 'p@unfoldingword.org' : null,
    grants: held.map((grant, index) => ({
      grantId: `00000000-0000-4000-8000-0000000000${String(index + 10)}`,
      role: grant.role,
      scopeKind: grant.scope === 'org' ? 'org' : 'jd_area',
      scopeArea: grant.scope === 'org' ? null : grant.scope,
      expiresAt: grant.expiresAt,
    })),
    interactive,
  });
}

function resourceOf(asked: Asked) {
  const { area, bindings, usedBy, revealGrants } = asked;
  return { kind: 'credential', credentialId, area, bindings, usedBy, revealGrants } as const;
}

const ranks = new Map([
  ['viewer', 1],
  ['editor', 2],
  ['admin', 3],
]);

function liveRanks(held: readonly HeldGrant[], scope: string): number[] {
  return held
    .filter((grant) => grant.expiresAt === null || grant.expiresAt > at.toISOString())
    .filter((grant) => grant.scope === scope)
    .map((grant) => ranks.get(grant.role) ?? 0);
}

function isBound(asked: Asked): boolean {
  const used = asked.usedBy;
  if (used === null) return false;
  return asked.bindings.some(
    (binding) => binding.harnessId === used.harnessId && binding.connectorKey === used.connectorKey,
  );
}

function isGrantedReveal(asked: Asked): boolean {
  return asked.revealGrants.some(
    (grant) =>
      grant.credentialId === credentialId &&
      grant.personId === actorId &&
      grant.expiresAt > at.toISOString(),
  );
}

function oracle(held: readonly HeldGrant[], asked: Asked): boolean {
  const onArea = Math.max(0, ...liveRanks(held, asked.area));
  const orgAdmin = liveRanks(held, 'org').includes(3);
  if (asked.capability === 'use') return onArea >= 2 && isBound(asked);
  if (asked.kind !== 'person' || !asked.interactive) return false;
  if (asked.capability === 'manage') return onArea >= 3 || orgAdmin;
  const sees = onArea >= 1 || orgAdmin;
  return asked.capability === 'see' ? sees : sees && isGrantedReveal(asked);
}

const heldArb = fc.array(grantArb, { maxLength: 5 });
const closedArb = fc.constantFrom('see' as const, 'reveal' as const, 'manage' as const);
const orgRolesArb = fc.array(fc.constantFrom('admin', 'editor', 'viewer'), { maxLength: 3 });

function agreesWithOracle(held: HeldGrant[], asked: Asked): void {
  const principal = holding(held, asked.kind, asked.interactive);
  const resource = resourceOf(asked);
  expect(can(principal, asked.capability, resource, at)).toBe(oracle(held, asked));
  expect(can(principal, 'read', resource, at)).toBe(false);
  expect(can(principal, 'write', resource, at)).toBe(false);
  expect(can(principal, 'admin', resource, at)).toBe(false);
}

function refusesAwayFromTheKeyboard(
  held: HeldGrant[],
  asked: Asked,
  capability: 'see' | 'reveal' | 'manage',
): void {
  fc.pre(asked.kind === 'agent' || !asked.interactive);
  const principal = holding(held, asked.kind, asked.interactive);
  expect(can(principal, capability, resourceOf(asked), at)).toBe(false);
}

function refusesOrgGrantsAlone(roles: string[], asked: Asked): void {
  const held = roles.map((role) => ({ role, scope: 'org', expiresAt: null }));
  const principal = holding(held, 'person', true);
  const bare = resourceOf({ ...asked, revealGrants: [] });
  const admin = roles.includes('admin');
  expect(can(principal, 'use', bare, at)).toBe(false);
  expect(can(principal, 'reveal', bare, at)).toBe(false);
  expect(can(principal, 'see', bare, at)).toBe(admin);
  expect(can(principal, 'manage', bare, at)).toBe(admin);
}

function refusesOtherAreas(held: HeldGrant[], asked: Asked): void {
  const away = held.filter((grant) => grant.scope !== 'org' && grant.scope !== asked.area);
  const principal = holding(away, asked.kind, asked.interactive);
  expect(can(principal, asked.capability, resourceOf(asked), at)).toBe(false);
}

describe('#156 can() answers a credential capability only by its written rule', () => {
  it('matches an independent oracle over grants, capabilities, bindings, reveals and kinds', () => {
    fc.assert(fc.property(heldArb, askedArb, agreesWithOracle), { numRuns: 4000 });
  });

  it('never lets an agent or a lent person see, reveal or manage, whatever it holds', () => {
    fc.assert(fc.property(heldArb, askedArb, closedArb, refusesAwayFromTheKeyboard), {
      numRuns: 1000,
    });
  });

  it('gives grants at org scope alone no use and no reveal, and see and manage to an admin', () => {
    fc.assert(fc.property(orgRolesArb, askedArb, refusesOrgGrantsAlone), { numRuns: 500 });
  });

  it('never lets a grant on another area reach a credential', () => {
    fc.assert(fc.property(heldArb, askedArb, refusesOtherAreas), { numRuns: 1000 });
  });
});
