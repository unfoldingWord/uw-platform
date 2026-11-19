import { describe, expect, it } from 'vitest';
import { personPrincipal } from '@uw/core/principal';
import type { AccessGrant, AccessPerson, AccessRecords } from '@uw/db/store';
import { accessViewOf } from './access-view.ts';

const at = new Date('2026-11-19T12:00:00.000Z');
const none = { scope: null, personId: null };

function person(n: number, name: string, status = 'active'): AccessPerson {
  const personId = `00000000-0000-4000-8000-00000000000${n}`;
  return { personId, email: `${name}@unfoldingword.org`, displayName: name, status };
}

const org = person(1, 'org.admin');
const infra = person(2, 'infra.admin');
const tech = person(3, 'tech.editor');
const fresh = person(4, 'new.teammate');
const outside = person(5, 'partner', 'pending');
const declined = person(6, 'stranger', 'disabled');

function grant(n: number, holder: AccessPerson, role: string, area: string | null): AccessGrant {
  return {
    grantId: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
    personId: holder.personId,
    role,
    scopeKind: area === null ? 'org' : 'jd_area',
    scopeArea: area,
    grantedBy: org.email,
    grantedAt: new Date('2026-11-01T00:00:00.000Z'),
    expiresAt: null,
  };
}

const grants = [
  grant(1, org, 'admin', null),
  grant(2, infra, 'admin', '30-39'),
  grant(3, tech, 'editor', '80-89'),
  grant(4, tech, 'viewer', '30-39'),
];

const records: AccessRecords = {
  people: [org, infra, tech, fresh, outside, declined],
  grants,
  grantChanges: grants.map((made) => ({
    at: made.grantedAt,
    actor: `human:${org.personId}`,
    action: 'grant',
    personId: made.personId,
    role: made.role,
    scopeKind: made.scopeKind,
    scopeArea: made.scopeArea,
  })),
  personChanges: [
    { at, actor: `human:${org.personId}`, action: 'decline', personId: declined.personId },
  ],
};

function viewer(who: AccessPerson) {
  const held = grants
    .filter((made) => made.personId === who.personId)
    .map((made) => ({
      grantId: made.grantId,
      role: made.role,
      scopeKind: made.scopeKind,
      scopeArea: made.scopeArea,
      expiresAt: null,
    }));
  return personPrincipal({ ...who, grants: held as never, interactive: true });
}

function shown(view: ReturnType<typeof accessViewOf>): string[] {
  return view.holders.flatMap((holder) =>
    holder.grants.map(
      (line) =>
        `${holder.person.displayName}:${line.grant.role}:${line.grant.scopeArea ?? 'org'}:${line.manageable ? 'manage' : 'see'}`,
    ),
  );
}

describe('#154 who sees which grants on the Access screen', () => {
  it('an org admin sees and manages every grant, and may grant in every scope', () => {
    const view = accessViewOf(records, viewer(org), none, at);
    expect(shown(view)).toEqual([
      'org.admin:admin:org:manage',
      'infra.admin:admin:30-39:manage',
      'tech.editor:editor:80-89:manage',
      'tech.editor:viewer:30-39:manage',
    ]);
    expect(view.grantScopes).toHaveLength(11);
    expect(view.grantScopes[0]).toEqual({ value: 'org', label: 'Whole organization' });
  });

  it('an area admin sees and manages only the grants on their own areas', () => {
    const view = accessViewOf(records, viewer(infra), none, at);
    expect(shown(view)).toEqual([
      'infra.admin:admin:30-39:manage',
      'tech.editor:viewer:30-39:manage',
    ]);
    expect(view.grantScopes).toEqual([{ value: '30-39', label: '30-39 Infrastructure' }]);
    expect(view.history.map((line) => line.detail)).toEqual([
      'admin · 30-39 Infrastructure',
      'viewer · 30-39 Infrastructure',
    ]);
  });

  it('a person with no admin grant sees their own grants, manages none, and sees nobody waiting', () => {
    const view = accessViewOf(records, viewer(tech), none, at);
    expect(shown(view)).toEqual(['tech.editor:editor:80-89:see', 'tech.editor:viewer:30-39:see']);
    expect(view.grantScopes).toEqual([]);
    expect(view.waiting).toEqual([]);
    expect(view.orgAdmin).toBe(false);
  });
});

describe('#154 who is waiting, the filters and the history on the Access screen', () => {
  it('lists people waiting: no grant yet, pending, and for an org admin the declined', () => {
    const forOrg = accessViewOf(records, viewer(org), none, at);
    expect(forOrg.waiting.map((waiting) => waiting.displayName)).toEqual([
      'new.teammate',
      'partner',
      'stranger',
    ]);
    const forArea = accessViewOf(records, viewer(infra), none, at);
    expect(forArea.waiting.map((waiting) => waiting.displayName)).toEqual([
      'new.teammate',
      'partner',
    ]);
    expect(forArea.grantable.map((choice) => choice.label)).not.toContain(
      'partner@unfoldingword.org (waiting for approval)',
    );
    expect(forOrg.grantable.map((choice) => choice.label)).toContain(
      'partner@unfoldingword.org (waiting for approval)',
    );
  });

  it('filters by scope and by person, and shows sign-in decisions only to an org admin', () => {
    const byScope = accessViewOf(records, viewer(org), { scope: '30-39', personId: null }, at);
    expect(shown(byScope)).toEqual([
      'infra.admin:admin:30-39:manage',
      'tech.editor:viewer:30-39:manage',
    ]);
    const byPerson = accessViewOf(
      records,
      viewer(org),
      { scope: null, personId: tech.personId },
      at,
    );
    expect(shown(byPerson)).toEqual([
      'tech.editor:editor:80-89:manage',
      'tech.editor:viewer:30-39:manage',
    ]);
    const all = accessViewOf(records, viewer(org), none, at);
    expect(all.history[0]).toMatchObject({ action: 'Declined', detail: 'Sign-in' });
    expect(
      accessViewOf(records, viewer(infra), none, at).history.map((line) => line.detail),
    ).not.toContain('Sign-in');
  });
});
