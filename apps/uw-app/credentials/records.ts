import { and, asc, desc, eq, gt, inArray, isNull, max } from 'drizzle-orm';
import type { JdArea, Principal } from '@uw/contracts';
import { can, managesOwnArea, type CredentialBinding, type RevealGrant } from '@uw/core/acl';
import { personPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import {
  credentialAccessLog,
  credentialBindings,
  credentialGrants,
  credentials,
  credentialVersions,
  people,
} from '@uw/db/schema';
import { createDrizzleGrants } from '@uw/db/store';
import { isId, resourceOf } from './standing.ts';

const LOG_SHOWN = 50;

type CredentialRow = typeof credentials.$inferSelect;
type GrantRow = typeof credentialGrants.$inferSelect;

type Named = { readonly personId: string; readonly email: string };

export type CredentialLine = {
  readonly id: string;
  readonly jdArea: JdArea;
  readonly jdRef: string | null;
  readonly name: string;
  readonly kind: string;
  readonly owner: string;
  readonly rotateBy: string | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly manageable: boolean;
  readonly revealable: boolean;
  readonly revealEndsAt: Date | null;
};

export type GrantLine = {
  readonly grantId: string;
  readonly person: string;
  readonly grantedBy: string;
  readonly grantedAt: Date;
  readonly expiresAt: Date;
  readonly waitsForSecond: boolean;
  readonly secondBy: string | null;
  readonly confirmable: boolean;
};

export type LogLine = {
  readonly at: Date;
  readonly action: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly actor: string;
  readonly person: string | null;
  readonly harnessId: string | null;
  readonly connectorKey: string | null;
};

export type Managed = {
  readonly alone: boolean;
  readonly version: number;
  readonly sealedAt: Date | null;
  readonly bindings: readonly CredentialBinding[];
  readonly grants: readonly GrantLine[];
  readonly seers: readonly Named[];
  readonly log: readonly LogLine[];
};

export type CredentialRecord = { readonly line: CredentialLine; readonly managed: Managed | null };

type Seeing = { readonly db: Database; readonly viewer: Principal; readonly at: Date };

function confirmed(grant: GrantRow): boolean {
  return !grant.secondRequired || grant.secondBy !== null;
}

async function ownGrants(seeing: Seeing): Promise<readonly GrantRow[]> {
  const { db, viewer, at } = seeing;
  if (viewer.personId === null) return [];
  const rows = await db
    .select()
    .from(credentialGrants)
    .where(
      and(
        eq(credentialGrants.personId, viewer.personId),
        eq(credentialGrants.capability, 'reveal'),
        isNull(credentialGrants.revokedAt),
        gt(credentialGrants.expiresAt, at),
      ),
    );
  return rows.filter(confirmed);
}

async function lastUses(db: Database, ids: readonly string[]): Promise<ReadonlyMap<string, Date>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ credentialId: credentialAccessLog.credentialId, at: max(credentialAccessLog.at) })
    .from(credentialAccessLog)
    .where(
      and(
        inArray(credentialAccessLog.credentialId, [...ids]),
        eq(credentialAccessLog.action, 'use'),
        eq(credentialAccessLog.outcome, 'done'),
      ),
    )
    .groupBy(credentialAccessLog.credentialId);
  return new Map(rows.flatMap((row) => (row.at === null ? [] : [[row.credentialId, row.at]])));
}

async function emailsOf(
  db: Database,
  ids: readonly (string | null)[],
): Promise<(personId: string | null) => string> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const rows =
    wanted.length === 0
      ? []
      : await db
          .select({ id: people.id, email: people.email })
          .from(people)
          .where(inArray(people.id, wanted));
  const emails = new Map(rows.map((row) => [row.id, row.email]));
  return (personId) => (personId === null ? null : emails.get(personId)) ?? 'Someone not listed';
}

function revealGrantsOf(grants: readonly GrantRow[], credentialId: string): RevealGrant[] {
  return grants
    .filter((grant) => grant.credentialId === credentialId)
    .map((grant) => ({
      credentialId,
      personId: grant.personId,
      expiresAt: grant.expiresAt.toISOString(),
    }));
}

type LineFacts = {
  readonly own: readonly GrantRow[];
  readonly used: ReadonlyMap<string, Date>;
  readonly email: (personId: string | null) => string;
};

function lineOf(row: CredentialRow, seeing: Seeing, facts: LineFacts): CredentialLine {
  const { viewer, at } = seeing;
  const revealGrants = revealGrantsOf(facts.own, row.id);
  const resource = { ...resourceOf(row), revealGrants };
  const revealable = can(viewer, 'reveal', resource, at);
  return {
    id: row.id,
    jdArea: row.jdArea,
    jdRef: row.jdRef,
    name: row.name,
    kind: row.kind,
    owner: facts.email(row.ownerId),
    rotateBy: row.rotateBy,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: facts.used.get(row.id) ?? null,
    manageable: can(viewer, 'manage', resource, at),
    revealable,
    revealEndsAt: revealable ? new Date(revealGrants[0]?.expiresAt ?? at) : null,
  };
}

async function linesOf(seeing: Seeing, rows: readonly CredentialRow[]): Promise<CredentialLine[]> {
  const seen = rows.filter((row) => can(seeing.viewer, 'see', resourceOf(row), seeing.at));
  const facts = {
    own: await ownGrants(seeing),
    used: await lastUses(
      seeing.db,
      seen.map((row) => row.id),
    ),
    email: await emailsOf(
      seeing.db,
      seen.map((row) => row.ownerId),
    ),
  };
  return seen.map((row) => lineOf(row, seeing, facts));
}

export async function seenCredentials(
  db: Database,
  viewer: Principal,
  at: Date,
): Promise<readonly CredentialLine[]> {
  const rows = await db
    .select()
    .from(credentials)
    .orderBy(asc(credentials.jdArea), asc(credentials.name));
  return linesOf({ db, viewer, at }, rows);
}

async function grantLines(seeing: Seeing, credentialId: string): Promise<GrantLine[]> {
  const { db, viewer, at } = seeing;
  const rows = await db
    .select()
    .from(credentialGrants)
    .where(
      and(
        eq(credentialGrants.credentialId, credentialId),
        isNull(credentialGrants.revokedAt),
        gt(credentialGrants.expiresAt, at),
      ),
    )
    .orderBy(asc(credentialGrants.grantedAt), asc(credentialGrants.id));
  const email = await emailsOf(
    db,
    rows.flatMap((row) => [row.personId, row.grantedBy, row.secondBy]),
  );
  return rows.map((row) => ({
    grantId: row.id,
    person: email(row.personId),
    grantedBy: email(row.grantedBy),
    grantedAt: row.grantedAt,
    expiresAt: row.expiresAt,
    waitsForSecond: !confirmed(row),
    secondBy: row.secondBy === null ? null : email(row.secondBy),
    confirmable: !confirmed(row) && row.grantedBy !== viewer.personId,
  }));
}

async function logLines(db: Database, credentialId: string): Promise<LogLine[]> {
  const rows = await db
    .select()
    .from(credentialAccessLog)
    .where(eq(credentialAccessLog.credentialId, credentialId))
    .orderBy(desc(credentialAccessLog.position))
    .limit(LOG_SHOWN);
  const email = await emailsOf(
    db,
    rows.map((row) => row.personId),
  );
  return rows.map((row) => ({
    at: row.at,
    action: row.action,
    outcome: row.outcome,
    reason: row.reason,
    actor: row.actor,
    person: row.personId === null ? null : email(row.personId),
    harnessId: row.harnessId,
    connectorKey: row.connectorKey,
  }));
}

async function seersOf(seeing: Seeing, row: CredentialRow): Promise<Named[]> {
  const holders = await createDrizzleGrants(seeing.db).holders(row.jdArea, seeing.at);
  return holders
    .filter((holder) =>
      can(personPrincipal({ ...holder, interactive: true }), 'see', resourceOf(row), seeing.at),
    )
    .map(({ personId, email }) => ({ personId, email }));
}

async function managedOf(seeing: Seeing, row: CredentialRow): Promise<Managed> {
  const { db, viewer, at } = seeing;
  const [latest] = await db
    .select({ version: credentialVersions.version, sealedAt: credentialVersions.createdAt })
    .from(credentialVersions)
    .where(eq(credentialVersions.credentialId, row.id))
    .orderBy(desc(credentialVersions.version))
    .limit(1);
  const bindings = await db
    .select({
      harnessId: credentialBindings.harnessId,
      connectorKey: credentialBindings.connectorKey,
    })
    .from(credentialBindings)
    .where(eq(credentialBindings.credentialId, row.id))
    .orderBy(asc(credentialBindings.createdAt));
  return {
    alone: managesOwnArea(viewer, resourceOf(row), at),
    version: latest?.version ?? 0,
    sealedAt: latest?.sealedAt ?? null,
    bindings,
    grants: await grantLines(seeing, row.id),
    seers: await seersOf(seeing, row),
    log: await logLines(db, row.id),
  };
}

export async function seenCredential(
  db: Database,
  viewer: Principal,
  credentialId: string,
  at: Date,
): Promise<CredentialRecord | null> {
  if (!isId(credentialId)) return null;
  const rows = await db.select().from(credentials).where(eq(credentials.id, credentialId));
  const seeing = { db, viewer, at };
  const [line] = await linesOf(seeing, rows);
  const [row] = rows;
  if (line === undefined || row === undefined) return null;
  return { line, managed: line.manageable ? await managedOf(seeing, row) : null };
}

export function manageableAreas(
  viewer: Principal,
  areas: readonly JdArea[],
  at: Date,
): readonly JdArea[] {
  const placeholder = '00000000-0000-4000-8000-000000000000';
  return areas.filter((jdArea) =>
    can(viewer, 'manage', resourceOf({ id: placeholder, jdArea }), at),
  );
}
