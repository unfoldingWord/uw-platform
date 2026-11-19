import { asc, desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AnyExecutor } from '../any-database.ts';
import { grantAudit, people, personAudit, roleGrants } from '../schema.ts';
import { liveGrant } from './grants.ts';

const HISTORY_LIMIT = 200;

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
  const granter = alias(people, 'granter');
  return db
    .select({
      grantId: roleGrants.id,
      personId: roleGrants.personId,
      role: roleGrants.role,
      scopeKind: roleGrants.scopeKind,
      scopeArea: roleGrants.scopeArea,
      grantedBy: granter.email,
      grantedAt: roleGrants.grantedAt,
      expiresAt: roleGrants.expiresAt,
    })
    .from(roleGrants)
    .leftJoin(granter, eq(granter.id, roleGrants.grantedBy))
    .where(liveGrant(at))
    .orderBy(asc(roleGrants.grantedAt), asc(roleGrants.id));
}

function readGrantChanges(db: AnyExecutor): Promise<AccessGrantChange[]> {
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
    .orderBy(desc(grantAudit.at), desc(grantAudit.id))
    .limit(HISTORY_LIMIT);
}

function readPersonChanges(db: AnyExecutor): Promise<AccessPersonChange[]> {
  return db
    .select({
      at: personAudit.at,
      actor: personAudit.actor,
      action: personAudit.action,
      personId: personAudit.personId,
    })
    .from(personAudit)
    .orderBy(desc(personAudit.at), desc(personAudit.id))
    .limit(HISTORY_LIMIT);
}

export async function readAccessRecords(db: AnyExecutor, at: Date): Promise<AccessRecords> {
  const [everyone, grants, grantChanges, personChanges] = await Promise.all([
    readPeople(db),
    readLiveGrants(db, at),
    readGrantChanges(db),
    readPersonChanges(db),
  ]);
  return { people: everyone, grants, grantChanges, personChanges };
}
