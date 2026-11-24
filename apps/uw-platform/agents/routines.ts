import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import type { CapabilityWord, ErrorReason } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import { advisoryLock, advisoryLocks } from '@uw/db/advisory-locks';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { pgConstraint, pgErrorCode } from '@uw/db/errors';
import { delegations, harnesses, people, routines, serviceTokens } from '@uw/db/schema';
import { claimsByAgent, resolveGrants, subscriptionTokensFor } from '@uw/db/store';
import { lockPerson } from '../people/directory.ts';

const UNIQUE_VIOLATION = '23505';
const SETUP_CONFLICTS = new Set([
  'routines_one_live_per_delegation',
  'service_tokens_one_live_client',
  'service_tokens_one_live_device',
]);
const SEEN_EVERY_MS = 60_000;

export type RoutineGrant = {
  readonly delegationId: string;
  readonly persona: string;
  readonly capability: CapabilityWord;
  readonly expiresAt: Date;
};

export type RoutineSetup = {
  readonly harnessId: string;
  readonly routineId: string;
  readonly name: string;
  readonly device: string;
  readonly delegationId: string;
  readonly accessTokenId: string;
  readonly clientId: string;
};

type Checked =
  | { readonly ok: true; readonly grant: RoutineGrant }
  | { readonly ok: false; readonly reason: ErrorReason };

export type RoutineChange =
  | { readonly ok: true; readonly accessTokenId: string }
  | { readonly ok: false; readonly reason: ErrorReason };

function refusedWith(reason: ErrorReason): { readonly ok: false; readonly reason: ErrorReason } {
  return { ok: false, reason };
}

async function freshActor(tx: Transaction, actor: Principal, at: Date): Promise<Principal | null> {
  if (actor.kind !== 'person' || actor.personId === null) return null;
  await tx.execute(advisoryLock(advisoryLocks.grantCommands));
  const person = await lockPerson(tx, actor.personId);
  if (person?.status !== 'active') return null;
  const grants = await resolveGrants(tx, actor.personId, { at, lock: 'share' });
  return { ...actor, grants };
}

async function checkInTransaction(
  tx: Transaction,
  actor: Principal,
  harnessId: string,
  delegationId: string,
  at: Date,
): Promise<Checked> {
  const fresh = await freshActor(tx, actor, at);
  if (fresh === null) return refusedWith('not_permitted');
  const [row] = await tx
    .select({
      personId: delegations.personId,
      persona: delegations.persona,
      capability: delegations.capability,
      expiresAt: delegations.expiresAt,
      revokedAt: delegations.revokedAt,
      lapsedAt: delegations.lapsedAt,
      jdArea: harnesses.jdArea,
    })
    .from(delegations)
    .innerJoin(harnesses, eq(harnesses.id, delegations.harnessId))
    .where(and(eq(delegations.id, delegationId), eq(delegations.harnessId, harnessId)));
  if (row === undefined || row.personId !== fresh.personId) {
    return refusedWith('delegation_not_found');
  }
  if (!can(fresh, 'admin', { kind: 'area', area: row.jdArea }, at)) {
    return refusedWith('not_permitted');
  }
  const ended = row.revokedAt !== null || row.lapsedAt !== null;
  if (ended || row.expiresAt.getTime() <= at.getTime() || row.capability === 'none') {
    return refusedWith('delegation_lapsed');
  }
  const grant: RoutineGrant = {
    delegationId,
    persona: row.persona,
    capability: row.capability as CapabilityWord,
    expiresAt: row.expiresAt,
  };
  return { ok: true, grant };
}

export function checkRoutineGrant(
  db: Database,
  actor: Principal,
  harnessId: string,
  delegationId: string,
  at: Date,
): Promise<Checked> {
  return db.transaction((tx) => checkInTransaction(tx, actor, harnessId, delegationId, at));
}

async function bindInTransaction(
  tx: Transaction,
  actor: Principal,
  setup: RoutineSetup,
  traceId: string,
  at: Date,
): Promise<Checked> {
  const checked = await checkInTransaction(tx, actor, setup.harnessId, setup.delegationId, at);
  if (!checked.ok || actor.personId === null) return checked;
  const serviceTokenId = crypto.randomUUID();
  await tx.insert(serviceTokens).values({
    id: serviceTokenId,
    clientId: setup.clientId,
    personId: actor.personId,
    device: setup.device,
    boundBy: actor.identity,
    boundAt: at,
    traceId,
  });
  await tx.insert(routines).values({
    id: setup.routineId,
    serviceTokenId,
    delegationId: setup.delegationId,
    name: setup.name,
    accessTokenId: setup.accessTokenId,
    createdAt: at,
    traceId,
  });
  return checked;
}

export async function bindOwnRoutine(
  db: Database,
  actor: Principal,
  setup: RoutineSetup,
  traceId: string,
  at: Date,
): Promise<Checked> {
  try {
    return await db.transaction((tx) => bindInTransaction(tx, actor, setup, traceId, at));
  } catch (error) {
    const conflict =
      pgErrorCode(error) === UNIQUE_VIOLATION && SETUP_CONFLICTS.has(pgConstraint(error) ?? '');
    if (conflict) return refusedWith('grant_exists');
    throw error;
  }
}

type Target = {
  readonly routineId: string;
  readonly serviceTokenId: string;
  readonly accessTokenId: string;
  readonly ownerId: string;
};

async function lockTarget(tx: Transaction, routineId: string): Promise<Target | null> {
  const [row] = await tx
    .select({
      routineId: routines.id,
      serviceTokenId: routines.serviceTokenId,
      accessTokenId: routines.accessTokenId,
      ownerId: serviceTokens.personId,
    })
    .from(routines)
    .innerJoin(serviceTokens, eq(serviceTokens.id, routines.serviceTokenId))
    .where(and(eq(routines.id, routineId), isNull(routines.revokedAt)))
    .for('update', { of: routines });
  return row ?? null;
}

async function mayChange(
  tx: Transaction,
  actor: Principal,
  target: Target,
  at: Date,
): Promise<boolean> {
  const fresh = await freshActor(tx, actor, at);
  if (fresh === null) return false;
  return fresh.personId === target.ownerId || can(fresh, 'admin', { kind: 'org' }, at);
}

type Change = 'pause' | 'resume' | 'revoke';

async function changeInTransaction(
  tx: Transaction,
  actor: Principal,
  routineId: string,
  change: Change,
  at: Date,
): Promise<RoutineChange> {
  const target = await lockTarget(tx, routineId);
  if (target === null) return refusedWith('grant_not_found');
  if (!(await mayChange(tx, actor, target, at))) return refusedWith('not_permitted');
  if (change === 'revoke') {
    await tx.update(routines).set({ revokedAt: at }).where(eq(routines.id, routineId));
    await tx
      .update(serviceTokens)
      .set({ revokedAt: at })
      .where(and(eq(serviceTokens.id, target.serviceTokenId), isNull(serviceTokens.revokedAt)));
  } else {
    const pausedAt = change === 'pause' ? at : null;
    await tx.update(routines).set({ pausedAt }).where(eq(routines.id, routineId));
  }
  return { ok: true, accessTokenId: target.accessTokenId };
}

export function changeRoutine(
  db: Database,
  actor: Principal,
  routineId: string,
  change: Change,
  at: Date,
): Promise<RoutineChange> {
  if (actor.kind !== 'person') return Promise.resolve(refusedWith('not_permitted'));
  return db.transaction((tx) => changeInTransaction(tx, actor, routineId, change, at));
}

export type RoutineBinding = {
  readonly id: string;
  readonly delegationId: string;
  readonly paused: boolean;
};

export async function routineOfServiceToken(
  db: Executor,
  serviceTokenId: string,
): Promise<RoutineBinding | null> {
  const [row] = await db
    .select({ id: routines.id, delegationId: routines.delegationId, pausedAt: routines.pausedAt })
    .from(routines)
    .where(and(eq(routines.serviceTokenId, serviceTokenId), isNull(routines.revokedAt)));
  if (row === undefined) return null;
  return { id: row.id, delegationId: row.delegationId, paused: row.pausedAt !== null };
}

export async function noteRoutineSeen(db: Executor, routineId: string, at: Date): Promise<void> {
  const stale = new Date(at.getTime() - SEEN_EVERY_MS);
  await db
    .update(routines)
    .set({ lastSeenAt: at })
    .where(
      and(
        eq(routines.id, routineId),
        or(isNull(routines.lastSeenAt), lt(routines.lastSeenAt, stale)),
      ),
    );
}

export type RoutineRow = {
  readonly id: string;
  readonly name: string;
  readonly device: string;
  readonly personId: string;
  readonly ownerName: string;
  readonly persona: string;
  readonly capability: CapabilityWord;
  readonly delegationId: string;
  readonly permissionEndsAt: Date;
  readonly permissionEnded: boolean;
  readonly paused: boolean;
  readonly lastSeenAt: Date | null;
  readonly itemsClaimed: number;
  readonly tokens: number;
};

function routineRowsQuery(db: Executor, harnessId: string) {
  return db
    .select({
      id: routines.id,
      name: routines.name,
      device: serviceTokens.device,
      personId: serviceTokens.personId,
      ownerName: people.displayName,
      persona: delegations.persona,
      capability: delegations.capability,
      delegationId: routines.delegationId,
      expiresAt: delegations.expiresAt,
      delegationRevokedAt: delegations.revokedAt,
      lapsedAt: delegations.lapsedAt,
      pausedAt: routines.pausedAt,
      lastSeenAt: routines.lastSeenAt,
    })
    .from(routines)
    .innerJoin(serviceTokens, eq(serviceTokens.id, routines.serviceTokenId))
    .innerJoin(delegations, eq(delegations.id, routines.delegationId))
    .innerJoin(people, eq(people.id, serviceTokens.personId))
    .where(and(eq(delegations.harnessId, harnessId), isNull(routines.revokedAt)))
    .orderBy(asc(routines.createdAt), asc(routines.id));
}

type QueriedRoutine = Awaited<ReturnType<typeof routineRowsQuery>>[number];

function ended(row: QueriedRoutine, at: Date): boolean {
  const gone = row.delegationRevokedAt !== null || row.lapsedAt !== null;
  return gone || row.expiresAt.getTime() <= at.getTime();
}

export async function routinesOnHarness(
  db: Executor,
  harnessId: string,
  at: Date,
): Promise<readonly RoutineRow[]> {
  const rows = await routineRowsQuery(db, harnessId);
  const agents = rows.map((row) => ({
    identityPrefix: `agent:${row.personId}/${row.device}`,
    delegationId: row.delegationId,
  }));
  const claims = await claimsByAgent(db, harnessId, agents);
  const tokens = await subscriptionTokensFor(
    db,
    rows.map((row) => row.delegationId),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    device: row.device,
    personId: row.personId,
    ownerName: row.ownerName,
    persona: row.persona,
    capability: row.capability as CapabilityWord,
    delegationId: row.delegationId,
    permissionEndsAt: row.expiresAt,
    permissionEnded: ended(row, at),
    paused: row.pausedAt !== null,
    lastSeenAt: row.lastSeenAt,
    itemsClaimed: claims.get(row.delegationId) ?? 0,
    tokens: tokens.get(row.delegationId) ?? 0,
  }));
}
