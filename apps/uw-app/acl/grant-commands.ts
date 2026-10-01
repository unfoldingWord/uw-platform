import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  scopeSchema,
  type ErrorReason,
  type GrantRoleCommand,
  type RevokeRoleCommand,
  type Scope,
} from '@uw/contracts';
import { can, type AclResource } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { grantAudit, roleGrants } from '@uw/db/schema';
import type { CommandResult } from '../http/commands.ts';
import { pgConstraint, pgErrorCode } from '../http/pg-errors.ts';
import { liveGrant, toGrant } from './grant-store.ts';
import { activatePerson, lockPerson } from '../people/directory.ts';

export const owns = ['role_grants', 'grant_audit'] as const;

type GrantRow = typeof roleGrants.$inferSelect;

const ONE_LIVE_GRANT_CONSTRAINT = 'role_grants_one_live';
const UNIQUE_VIOLATION = '23505';

const accepted: CommandResult = { ok: true };

function refused(reason: ErrorReason): CommandResult {
  return { ok: false, reason };
}

function scopeResource(scopeKind: Scope, scopeArea: string | null): AclResource {
  if (scopeKind === 'jd_area' && scopeArea !== null) return { kind: 'area', area: scopeArea };
  return { kind: 'org' };
}

function instant(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function auditRow(row: GrantRow) {
  return {
    id: row.id,
    person_id: row.personId,
    role: row.role,
    scope_kind: row.scopeKind,
    scope_area: row.scopeArea,
    granted_by: row.grantedBy,
    granted_at: instant(row.grantedAt),
    expires_at: instant(row.expiresAt),
    revoked_at: instant(row.revokedAt),
  };
}

type AuditEntry = {
  readonly actor: Principal;
  readonly action: 'grant' | 'revoke';
  readonly grantId: string;
  readonly before: GrantRow | null;
  readonly after: GrantRow;
  readonly traceId: string;
};

async function writeAudit(tx: Executor, entry: AuditEntry): Promise<void> {
  await tx.insert(grantAudit).values({
    actor: entry.actor.identity,
    action: entry.action,
    grantId: entry.grantId,
    before: entry.before === null ? null : auditRow(entry.before),
    after: auditRow(entry.after),
    traceId: entry.traceId,
  });
}

function sameScope(command: GrantRoleCommand) {
  return and(
    eq(roleGrants.personId, command.personId),
    eq(roleGrants.role, command.role),
    eq(roleGrants.scopeKind, command.scopeKind),
    command.scopeArea === null
      ? isNull(roleGrants.scopeArea)
      : eq(roleGrants.scopeArea, command.scopeArea),
    isNull(roleGrants.revokedAt),
  );
}

async function closeExpiredDuplicate(
  tx: Transaction,
  actor: Principal,
  command: GrantRoleCommand,
  traceId: string,
): Promise<void> {
  const [expired] = await tx
    .select()
    .from(roleGrants)
    .where(and(sameScope(command), lte(roleGrants.expiresAt, sql`now()`)))
    .for('update');
  if (!expired) return;
  const [closed] = await tx
    .update(roleGrants)
    .set({ revokedAt: sql`now()` })
    .where(eq(roleGrants.id, expired.id))
    .returning();
  if (!closed) throw new Error('an expired grant locked in this transaction must update');
  await writeAudit(tx, {
    actor,
    action: 'revoke',
    grantId: expired.id,
    before: expired,
    after: closed,
    traceId,
  });
}

async function approvePending(tx: Transaction, actor: Principal, personId: string) {
  if (!can(actor, 'admin', { kind: 'org' })) return refused('not_permitted');
  await activatePerson(tx, personId);
  return accepted;
}

async function insertGrant(
  tx: Transaction,
  actor: Principal,
  command: GrantRoleCommand,
  traceId: string,
): Promise<void> {
  const [row] = await tx
    .insert(roleGrants)
    .values({
      personId: command.personId,
      role: command.role,
      scopeKind: command.scopeKind,
      scopeArea: command.scopeArea,
      expiresAt: command.expiresAt === null ? null : new Date(command.expiresAt),
      grantedBy: actor.personId,
    })
    .returning();
  if (!row) throw new Error('an inserted grant must return its row');
  await writeAudit(tx, {
    actor,
    action: 'grant',
    grantId: row.id,
    before: null,
    after: row,
    traceId,
  });
}

async function withLiveGrants(tx: Transaction, actor: Principal): Promise<Principal> {
  if (actor.personId === null) return { ...actor, grants: [] };
  const rows = await tx
    .select()
    .from(roleGrants)
    .where(and(eq(roleGrants.personId, actor.personId), liveGrant()))
    .orderBy(asc(roleGrants.id))
    .for('share');
  return { ...actor, grants: rows.map(toGrant) };
}

async function grantInTransaction(
  tx: Transaction,
  actor: Principal,
  command: GrantRoleCommand,
  traceId: string,
): Promise<CommandResult> {
  const live = await withLiveGrants(tx, actor);
  if (!can(live, 'admin', scopeResource(command.scopeKind, command.scopeArea))) {
    return refused('not_permitted');
  }
  const person = await lockPerson(tx, command.personId);
  if (!person) return refused('person_not_found');
  if (person.status === 'pending') {
    const approval = await approvePending(tx, live, command.personId);
    if (!approval.ok) return approval;
  }
  await closeExpiredDuplicate(tx, live, command, traceId);
  await insertGrant(tx, live, command, traceId);
  return accepted;
}

function isLiveGrantConflict(error: unknown): boolean {
  return (
    pgErrorCode(error) === UNIQUE_VIOLATION && pgConstraint(error) === ONE_LIVE_GRANT_CONSTRAINT
  );
}

export async function grantRole(
  db: Database,
  actor: Principal,
  command: GrantRoleCommand,
  traceId: string,
): Promise<CommandResult> {
  if (!can(actor, 'admin', scopeResource(command.scopeKind, command.scopeArea))) {
    return refused('not_permitted');
  }
  if (command.expiresAt !== null && new Date(command.expiresAt).getTime() <= Date.now()) {
    return refused('expiry_in_past');
  }
  try {
    return await db.transaction((tx) => grantInTransaction(tx, actor, command, traceId));
  } catch (error) {
    if (isLiveGrantConflict(error)) return refused('grant_exists');
    throw error;
  }
}

async function lockLiveOrgAdmins(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ id: roleGrants.id })
    .from(roleGrants)
    .where(and(eq(roleGrants.role, 'admin'), eq(roleGrants.scopeKind, 'org'), liveGrant()))
    .orderBy(asc(roleGrants.id))
    .for('update');
  return rows.map((row) => row.id);
}

type Locked = { readonly target: GrantRow | null; readonly live: Principal };

async function lockTargetAndCallerGrants(
  tx: Transaction,
  actor: Principal,
  grantId: string,
): Promise<Locked> {
  const isTarget = and(eq(roleGrants.id, grantId), isNull(roleGrants.revokedAt));
  const isCallers =
    actor.personId === null ? undefined : and(eq(roleGrants.personId, actor.personId), liveGrant());
  const rows = await tx
    .select({
      grant: roleGrants,
      live: sql<boolean>`(${roleGrants.revokedAt} IS NULL AND (${roleGrants.expiresAt} IS NULL OR ${roleGrants.expiresAt} > now()))`,
    })
    .from(roleGrants)
    .where(or(isTarget, isCallers))
    .orderBy(asc(roleGrants.id))
    .for('update');
  const callers = rows.filter((row) => row.live && row.grant.personId === actor.personId);
  return {
    target: rows.find((row) => row.grant.id === grantId)?.grant ?? null,
    live: { ...actor, grants: callers.map((row) => toGrant(row.grant)) },
  };
}

async function revokeInTransaction(
  tx: Transaction,
  actor: Principal,
  command: RevokeRoleCommand,
  traceId: string,
): Promise<CommandResult> {
  const orgAdminIds = await lockLiveOrgAdmins(tx);
  const { target: locked, live } = await lockTargetAndCallerGrants(tx, actor, command.grantId);
  if (!locked) return refused('grant_not_found');
  if (!can(live, 'admin', scopeResource(scopeSchema.parse(locked.scopeKind), locked.scopeArea))) {
    return refused('not_permitted');
  }
  if (orgAdminIds.length === 1 && orgAdminIds.includes(locked.id)) {
    return refused('last_org_admin');
  }
  const [updated] = await tx
    .update(roleGrants)
    .set({ revokedAt: sql`now()` })
    .where(eq(roleGrants.id, locked.id))
    .returning();
  if (!updated) throw new Error('a grant locked in this transaction must update');
  await writeAudit(tx, {
    actor,
    action: 'revoke',
    grantId: locked.id,
    before: locked,
    after: updated,
    traceId,
  });
  return accepted;
}

export function revokeRole(
  db: Database,
  actor: Principal,
  command: RevokeRoleCommand,
  traceId: string,
): Promise<CommandResult> {
  return db.transaction((tx) => revokeInTransaction(tx, actor, command, traceId));
}
