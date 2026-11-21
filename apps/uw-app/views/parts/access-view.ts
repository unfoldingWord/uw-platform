import type { Principal } from '@uw/contracts';
import { can, type RestrictedTable } from '@uw/core/acl';
import type { AccessGrant, AccessHistoryQuery, AccessPerson, AccessRecords } from '@uw/db/store';
import { areaLabel, everyArea } from './names.ts';

export const ORG_SCOPE = 'org';
const HISTORY_SHOWN = 20;

export type AccessFilter = { readonly scope: string | null; readonly personId: string | null };
type Choice = { readonly value: string; readonly label: string };
export type GrantLine = { readonly grant: AccessGrant; readonly manageable: boolean };
export type Holder = { readonly person: AccessPerson; readonly grants: readonly GrantLine[] };

type HistoryLine = {
  readonly at: Date;
  readonly actor: string;
  readonly action: string;
  readonly person: string;
  readonly detail: string;
};

export type AccessView = {
  readonly orgAdmin: boolean;
  readonly grantScopes: readonly Choice[];
  readonly grantable: readonly Choice[];
  readonly waiting: readonly AccessPerson[];
  readonly holders: readonly Holder[];
  readonly filterScopes: readonly Choice[];
  readonly filterPeople: readonly Choice[];
  readonly history: readonly HistoryLine[];
};

type Scoped = { readonly personId: string; readonly scopeArea: string | null };
type Seeing = { readonly viewer: Principal; readonly at: Date; readonly filter: AccessFilter };

export function scopeOf(grant: { readonly scopeArea: string | null }): string {
  return grant.scopeArea ?? ORG_SCOPE;
}

export function scopeLabel(scope: string): string {
  return scope === ORG_SCOPE ? 'Whole organization' : areaLabel(scope);
}

function manages(viewer: Principal, scope: string, at: Date): boolean {
  const resource =
    scope === ORG_SCOPE ? ({ kind: 'org' } as const) : ({ kind: 'area', area: scope } as const);
  return can(viewer, 'admin', resource, at);
}

function reads(seeing: Seeing, table: RestrictedTable, record: Scoped): boolean {
  const row = { kind: 'row', table, area: record.scopeArea, ownerId: record.personId } as const;
  return can(seeing.viewer, 'read', row, seeing.at);
}

function kept(filter: AccessFilter, grant: Scoped): boolean {
  const scope = filter.scope === null || scopeOf(grant) === filter.scope;
  return scope && (filter.personId === null || grant.personId === filter.personId);
}

export function historyQueryOf(
  viewer: Principal,
  filter: AccessFilter,
  at: Date,
): AccessHistoryQuery {
  return {
    everything: manages(viewer, ORG_SCOPE, at),
    areas: everyArea().filter((area) => manages(viewer, area, at)),
    viewerId: viewer.personId,
    scope: filter.scope,
    personId: filter.personId,
    limit: HISTORY_SHOWN,
  };
}

function grantScopesOf(viewer: Principal, at: Date): readonly Choice[] {
  return [ORG_SCOPE, ...everyArea()]
    .filter((scope) => manages(viewer, scope, at))
    .map((scope) => ({ value: scope, label: scopeLabel(scope) }));
}

function personChoice(person: AccessPerson): Choice {
  const pending = person.status === 'pending' ? ' (waiting for approval)' : '';
  return { value: person.personId, label: `${person.email}${pending}` };
}

function holdersOf(
  everyone: readonly AccessPerson[],
  grants: readonly AccessGrant[],
  seeing: Seeing,
): readonly Holder[] {
  return everyone.flatMap((person) => {
    const own = grants
      .filter((grant) => grant.personId === person.personId)
      .map((grant) => ({ grant, manageable: manages(seeing.viewer, scopeOf(grant), seeing.at) }));
    return own.length === 0 ? [] : [{ person, grants: own }];
  });
}

function waitingOf(records: AccessRecords, orgAdmin: boolean): readonly AccessPerson[] {
  const holding = new Set(records.grants.map((grant) => grant.personId));
  return records.people.filter((person) => {
    if (person.status === 'disabled') return orgAdmin;
    return person.status === 'pending' || !holding.has(person.personId);
  });
}

const actionWords: ReadonlyMap<string, string> = new Map([
  ['grant', 'Granted'],
  ['revoke', 'Revoked'],
  ['bootstrap', 'Granted at setup'],
  ['approve', 'Approved'],
  ['decline', 'Declined'],
]);

function namer(everyone: readonly AccessPerson[]): (personId: string) => string {
  const emails = new Map(everyone.map((person) => [person.personId, person.email]));
  return (personId) => emails.get(personId) ?? 'Someone no longer listed';
}

function actorName(actor: string, name: (personId: string) => string): string {
  return actor.startsWith('human:') ? name(actor.slice('human:'.length)) : 'The platform';
}

function historyOf(records: AccessRecords, seeing: Seeing, orgAdmin: boolean): HistoryLine[] {
  const name = namer(records.people);
  const line = (change: { at: Date; actor: string; action: string; personId: string }) => ({
    at: change.at,
    actor: actorName(change.actor, name),
    action: actionWords.get(change.action) ?? change.action,
    person: name(change.personId),
  });
  const grants = records.grantChanges
    .filter((change) => reads(seeing, 'grant_audit', change) && kept(seeing.filter, change))
    .map((change) => ({
      ...line(change),
      detail: `${change.role} · ${scopeLabel(scopeOf(change))}`,
    }));
  const signIns = records.personChanges
    .map((change) => ({ ...change, scopeArea: null }))
    .filter((change) => orgAdmin && reads(seeing, 'person_audit', change))
    .filter((change) => seeing.filter.scope === null && kept(seeing.filter, change))
    .map((change) => ({ ...line(change), detail: 'Sign-in' }));
  return [...grants, ...signIns]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, HISTORY_SHOWN);
}

export function accessViewOf(
  records: AccessRecords,
  viewer: Principal,
  filter: AccessFilter,
  at: Date,
): AccessView {
  const seeing = { viewer, at, filter };
  const orgAdmin = manages(viewer, ORG_SCOPE, at);
  const grantScopes = grantScopesOf(viewer, at);
  const visible = records.grants.filter((grant) => reads(seeing, 'role_grants', grant));
  const admin = grantScopes.length > 0;
  const chosenScope = filter.scope === null ? [] : [filter.scope];
  const scopes = [...new Set([...visible.map(scopeOf), ...chosenScope])].sort();
  const holding = new Set(visible.map((grant) => grant.personId));
  const choosable = (person: AccessPerson): boolean =>
    holding.has(person.personId) ||
    (person.personId === filter.personId && (admin || person.personId === viewer.personId));
  return {
    orgAdmin,
    grantScopes,
    grantable: records.people
      .filter((person) => person.status === 'active' || (orgAdmin && person.status === 'pending'))
      .map(personChoice),
    waiting: admin ? waitingOf(records, orgAdmin) : [],
    holders: holdersOf(
      records.people,
      visible.filter((grant) => kept(filter, grant)),
      seeing,
    ),
    filterScopes: scopes.map((scope) => ({ value: scope, label: scopeLabel(scope) })),
    filterPeople: records.people.filter(choosable).map(personChoice),
    history: historyOf(records, seeing, orgAdmin),
  };
}
