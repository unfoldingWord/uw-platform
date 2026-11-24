import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accessViewOf } from '../../apps/uw-platform/views/parts/access-view.ts';
import { principalSchema } from '../../packages/contracts/index.ts';

const at = new Date('2026-10-01T12:00:00.000Z');
const areas = ['20-29', '30-39', '80-89'];
const everyone = Array.from({ length: 4 }, (_, n) => ({
  personId: `00000000-0000-4000-8000-00000000000${String(n + 1)}`,
  email: `person${String(n + 1)}@unfoldingword.org`,
  displayName: `Person ${String(n + 1)}`,
  status: 'active',
}));
const noFilter = { scope: null, personId: null };

type Made = { readonly holder: number; readonly role: string; readonly scope: string };

const madeArb = fc.record({
  holder: fc.nat({ max: everyone.length - 1 }),
  role: fc.constantFrom('admin', 'editor', 'viewer'),
  scope: fc.constantFrom('org', ...areas),
});

const grantsArb = fc.uniqueArray(madeArb, {
  maxLength: 10,
  selector: (made) => `${String(made.holder)}:${made.role}:${made.scope}`,
});

function personIdOf(holder: number): string {
  return everyone[holder]?.personId ?? '';
}

function recordsOf(made: readonly Made[]) {
  const grants = made.map((grant, index) => ({
    grantId: `00000000-0000-4000-8000-0000000001${String(index + 10)}`,
    personId: personIdOf(grant.holder),
    role: grant.role,
    scopeKind: grant.scope === 'org' ? 'org' : 'jd_area',
    scopeArea: grant.scope === 'org' ? null : grant.scope,
    grantedBy: null,
    grantedAt: new Date(at.getTime() - (index + 1) * 60_000),
    expiresAt: null,
  }));
  const grantChanges = grants.map((grant) => ({
    at: grant.grantedAt,
    actor: 'agent:bootstrap',
    action: 'grant',
    personId: grant.personId,
    role: grant.role,
    scopeKind: grant.scopeKind,
    scopeArea: grant.scopeArea,
  }));
  return { people: everyone, grants, grantChanges, personChanges: [] };
}

function viewerOf(made: readonly Made[], viewer: number) {
  const personId = personIdOf(viewer);
  return principalSchema.parse({
    identity: `human:${personId}`,
    kind: 'person',
    personId,
    email: everyone[viewer]?.email,
    grants: made
      .filter((grant) => grant.holder === viewer)
      .map((grant, index) => ({
        grantId: `00000000-0000-4000-8000-0000000002${String(index + 10)}`,
        role: grant.role,
        scopeKind: grant.scope === 'org' ? 'org' : 'jd_area',
        scopeArea: grant.scope === 'org' ? null : grant.scope,
        expiresAt: null,
      })),
    interactive: true,
  });
}

function mayRead(made: readonly Made[], viewer: number, row: Made): boolean {
  const held = made.filter((grant) => grant.holder === viewer && grant.role === 'admin');
  if (row.holder === viewer) return true;
  if (held.some((grant) => grant.scope === 'org')) return true;
  return row.scope !== 'org' && held.some((grant) => grant.scope === row.scope);
}

function key(personId: string, role: string, scopeArea: string | null): string {
  return `${personId}:${role}:${scopeArea ?? 'org'}`;
}

function shownTo(made: readonly Made[], viewer: number) {
  const view = accessViewOf(recordsOf(made), viewerOf(made, viewer), noFilter, at);
  const grants = view.holders.flatMap((holder) =>
    holder.grants.map((line) => key(line.grant.personId, line.grant.role, line.grant.scopeArea)),
  );
  return { grants: grants.sort(), history: view.history.length };
}

function allowedTo(made: readonly Made[], viewer: number): string[] {
  return made
    .filter((row) => mayRead(made, viewer, row))
    .map((row) => key(personIdOf(row.holder), row.role, row.scope === 'org' ? null : row.scope))
    .sort();
}

describe('#155 the Access screen shows a grant or its history only by the declared rule', () => {
  it('shows exactly the grants an independent oracle lets the viewer read', () => {
    fc.assert(
      fc.property(grantsArb, fc.nat({ max: everyone.length - 1 }), (made, viewer) => {
        const shown = shownTo(made, viewer);
        const allowed = allowedTo(made, viewer);
        expect(shown.grants).toEqual(allowed);
        expect(shown.history).toBe(allowed.length);
      }),
      { numRuns: 500 },
    );
  });
});
