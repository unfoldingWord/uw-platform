import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyExecutor } from '../any-database.ts';
import { grantAudit, people, personAudit, roleGrants } from '../schema.ts';
import { liveGrant } from './grants.ts';

export type AccessHistoryQuery = {
  readonly everything: boolean;
  readonly areas: readonly string[];
  readonly viewerId: string | null;
  readonly scope: string | null;
  readonly personId: string | null;
  readonly limit: number;
};

const ORG_SCOPE = 'org';
const nothing = sql`false`;

export type AccessPerson = {
  readonly personId: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: string;
};

export type AccessGrant = {
  readonly grantId: string;
  readonly personId: string;
  readonly role: string;
  readonly scopeKind: string;
  readonly scopeArea: string | null;
  readonly grantedBy: string | null;
  readonly grantedAt: Date;
  readonly expiresAt: Date | null;
};

export type AccessGrantChange = {
  readonly at: Date;
  readonly actor: string;
  readonly action: string;
  readonly personId: string;
  readonly role: string;
  readonly scopeKind: string;
  readonly scopeArea: string | null;
};

export type AccessPersonChange = {
  readonly at: Date;
  readonly actor: string;
  readonly action: string;
  readonly personId: string;
};

export type AccessRecords = {
  readonly people: readonly AccessPerson[];
  readonly grants: readonly AccessGrant[];
  readonly grantChanges: readonly AccessGrantChange[];
  readonly personChanges: readonly AccessPersonChange[];
};

function readPeople(db: AnyExecutor): Promise<AccessPerson[]> {
  return db
    .select({
      personId: people.id,
      email: people.email,
      displayName: people.displayName,
      status: people.status,
    })
    .from(people)
    .orderBy(asc(people.email));
}

function readLiveGrants(db: AnyExecutor, at: Date): Promise<AccessGrant[]> {
  return db
    .select({
      grantId: roleGrants.id,
      personId: roleGrants.personId,
      role: roleGrants.role,
      scopeKind: roleGrants.scopeKind,
      scopeArea: roleGrants.scopeArea,
      grantedBy: roleGrants.grantedBy,
      grantedAt: roleGrants.grantedAt,
      expiresAt: roleGrants.expiresAt,
    })
    .from(roleGrants)
    .where(liveGrant(at))
    .orderBy(asc(roleGrants.grantedAt), asc(roleGrants.id));
}

function seenBy(query: AccessHistoryQuery): SQL | undefined {
  if (query.everything) return undefined;
  const own = query.viewerId === null ? nothing : eq(roleGrants.personId, query.viewerId);
  if (query.areas.length === 0) return own;
  return or(own, inArray(roleGrants.scopeArea, [...query.areas]));
}

function inScope(scope: string | null): SQL | undefined {
  if (scope === null) return undefined;
  return scope === ORG_SCOPE ? isNull(roleGrants.scopeArea) : eq(roleGrants.scopeArea, scope);
}

function readGrantChanges(
  db: AnyExecutor,
  query: AccessHistoryQuery,
): Promise<AccessGrantChange[]> {
  const person = query.personId === null ? undefined : eq(roleGrants.personId, query.personId);
  return db
    .select({
      at: grantAudit.at,
      actor: grantAudit.actor,
      action: grantAudit.action,
      personId: roleGrants.personId,
      role: roleGrants.role,
      scopeKind: roleGrants.scopeKind,
      scopeArea: roleGrants.scopeArea,
    })
    .from(grantAudit)
    .innerJoin(roleGrants, eq(roleGrants.id, grantAudit.grantId))
    .where(and(seenBy(query), inScope(query.scope), person))
    .orderBy(desc(grantAudit.at), desc(grantAudit.id))
    .limit(query.limit);
}

async function readPersonChanges(
  db: AnyExecutor,
  query: AccessHistoryQuery,
): Promise<AccessPersonChange[]> {
  if (!query.everything || query.scope !== null) return [];
  return db
    .select({
      at: personAudit.at,
      actor: personAudit.actor,
      action: personAudit.action,
      personId: personAudit.personId,
    })
    .from(personAudit)
    .where(query.personId === null ? undefined : eq(personAudit.personId, query.personId))
    .orderBy(desc(personAudit.at), desc(personAudit.id))
    .limit(query.limit);
}

export async function readAccessRecords(
  db: AnyExecutor,
  at: Date,
  history: AccessHistoryQuery,
): Promise<AccessRecords> {
  const [everyone, grants, grantChanges, personChanges] = await Promise.all([
    readPeople(db),
    readLiveGrants(db, at),
    readGrantChanges(db, history),
    readPersonChanges(db, history),
  ]);
  return { people: everyone, grants, grantChanges, personChanges };
}
