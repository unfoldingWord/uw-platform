import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Principal } from '@uw/contracts';
import { managesOwnArea } from '@uw/core/acl';
import { REVEAL_GRANT_MINUTES, type CredentialAccessAction } from '@uw/core/credentials';
import type { Transaction } from '@uw/db/client';
import { credentialGrants, credentials } from '@uw/db/schema';
import { personById } from '../people/directory.ts';
import { isId, locate, lockCredentialRow, resourceOf, type Located } from './standing.ts';
import {
  managerOf,
  recordAccess,
  refuseAndRecord,
  refuseUnpermitted,
  refused,
  type AccessEntry,
  type CredentialsDeps,
  type Refused,
} from './store.ts';

const MINUTE_MS = 60_000;

export type RevealGrantRequest = {
  readonly credentialId: string;
  readonly personId: string;
  readonly minutes: number;
};

export type Given =
  { readonly ok: true; readonly grantId: string; readonly waitsForSecond: boolean } | Refused;

export type GrantChanged = { readonly ok: true } | Refused;

type Stamp = { readonly traceId: string; readonly at: Date };

function entryOf(
  actor: Principal,
  located: Located,
  action: CredentialAccessAction,
  stamp: Stamp,
): AccessEntry {
  return {
    credentialId: located.id,
    jdArea: located.jdArea,
    action,
    actor,
    usedBy: null,
    runId: null,
    ...stamp,
  };
}

function wholeMinutes(minutes: number): boolean {
  const { least, most } = REVEAL_GRANT_MINUTES;
  return Number.isInteger(minutes) && minutes >= least && minutes <= most;
}

function liveFor(request: RevealGrantRequest, at: Date) {
  return and(
    eq(credentialGrants.credentialId, request.credentialId),
    eq(credentialGrants.personId, request.personId),
    eq(credentialGrants.capability, 'reveal'),
    isNull(credentialGrants.revokedAt),
    gt(credentialGrants.expiresAt, at),
  );
}

type Giving = {
  readonly request: RevealGrantRequest;
  readonly grantedBy: string;
  readonly secondRequired: boolean;
  readonly entry: AccessEntry;
};

async function addGrant(tx: Transaction, giving: Giving): Promise<Given> {
  const { request, grantedBy, secondRequired, entry } = giving;
  const [locked] = await tx
    .select({ revokedAt: credentials.revokedAt })
    .from(credentials)
    .where(eq(credentials.id, request.credentialId))
    .for('update');
  if (locked === undefined || locked.revokedAt !== null) {
    return refuseAndRecord(tx, entry, { versionId: null, reason: 'credential_revoked' });
  }
  const held = await tx
    .select({ id: credentialGrants.id })
    .from(credentialGrants)
    .where(liveFor(request, entry.at));
  if (held.length > 0) return refused('grant_exists');
  const [added] = await tx
    .insert(credentialGrants)
    .values({
      credentialId: request.credentialId,
      personId: request.personId,
      capability: 'reveal',
      grantedBy,
      grantedAt: entry.at,
      expiresAt: new Date(entry.at.getTime() + request.minutes * MINUTE_MS),
      secondRequired,
    })
    .returning({ id: credentialGrants.id });
  if (added === undefined)
    throw new Error('a reveal grant inserted in this transaction must return');
  await recordAccess(tx, entry, { versionId: null, reason: null });
  return { ok: true, grantId: added.id, waitsForSecond: secondRequired };
}

export async function giveRevealGrant(
  deps: CredentialsDeps,
  actor: Principal,
  request: RevealGrantRequest,
  traceId: string,
): Promise<Given> {
  const at = deps.clock.now();
  const found = await locate(deps.db, actor, request.credentialId, at);
  if (found === null) return refused('credential_not_found');
  const entry = entryOf(actor, found, 'grant_reveal', { traceId, at });
  const grantedBy = managerOf(actor, found, at);
  if (grantedBy === null) return refuseUnpermitted(deps.db, entry, found);
  if (!wholeMinutes(request.minutes)) return refused('credential_malformed');
  const grantee = isId(request.personId) ? await personById(deps.db, request.personId) : null;
  if (grantee?.status !== 'active') return refused('person_not_found');
  const secondRequired = !managesOwnArea(actor, resourceOf(found), at);
  return deps.db.transaction((tx) => addGrant(tx, { request, grantedBy, secondRequired, entry }));
}

type GrantRow = typeof credentialGrants.$inferSelect;

type Asked = {
  readonly grant: GrantRow;
  readonly located: Located;
  readonly personId: string;
  readonly entry: AccessEntry;
};

async function asked(
  deps: CredentialsDeps,
  actor: Principal,
  change: { readonly grantId: string; readonly action: 'confirm_reveal' | 'revoke_reveal' },
  traceId: string,
): Promise<Asked | Refused> {
  const at = deps.clock.now();
  if (!isId(change.grantId)) return refused('grant_not_found');
  const [grant] = await deps.db
    .select()
    .from(credentialGrants)
    .where(eq(credentialGrants.id, change.grantId));
  if (grant === undefined) return refused('grant_not_found');
  const located = await locate(deps.db, actor, grant.credentialId, at);
  if (located === null) return refused('grant_not_found');
  const entry = entryOf(actor, located, change.action, { traceId, at });
  const personId = managerOf(actor, located, at);
  if (personId === null) return refuseUnpermitted(deps.db, entry, located, 'grant_not_found');
  return { grant, located, personId, entry };
}

function waiting(grant: GrantRow, at: Date): boolean {
  const open = grant.revokedAt === null && grant.expiresAt.getTime() > at.getTime();
  return open && grant.secondRequired && grant.secondBy === null;
}

export async function confirmRevealGrant(
  deps: CredentialsDeps,
  actor: Principal,
  grantId: string,
  traceId: string,
): Promise<GrantChanged> {
  const change = await asked(deps, actor, { grantId, action: 'confirm_reveal' }, traceId);
  if ('ok' in change) return change;
  const { grant, personId, entry } = change;
  if (!waiting(grant, entry.at)) return refused('grant_not_found');
  if (personId === grant.grantedBy) {
    await recordAccess(deps.db, entry, { versionId: null, reason: 'not_permitted' });
    return refused('second_admin_required');
  }
  const length = grant.expiresAt.getTime() - grant.grantedAt.getTime();
  return deps.db.transaction(async (tx) => {
    if (!(await lockCredentialRow(tx, grant.credentialId))) return refused('grant_not_found');
    const confirmed = await tx
      .update(credentialGrants)
      .set({
        secondBy: personId,
        secondAt: entry.at,
        expiresAt: new Date(entry.at.getTime() + length),
      })
      .where(
        and(
          eq(credentialGrants.id, grant.id),
          isNull(credentialGrants.secondBy),
          isNull(credentialGrants.revokedAt),
        ),
      )
      .returning({ id: credentialGrants.id });
    if (confirmed.length === 0) return refused('grant_not_found');
    await recordAccess(tx, entry, { versionId: null, reason: null });
    return { ok: true };
  });
}

export async function revokeRevealGrant(
  deps: CredentialsDeps,
  actor: Principal,
  grantId: string,
  traceId: string,
): Promise<GrantChanged> {
  const change = await asked(deps, actor, { grantId, action: 'revoke_reveal' }, traceId);
  if ('ok' in change) return change;
  const { grant, entry } = change;
  return deps.db.transaction(async (tx) => {
    if (!(await lockCredentialRow(tx, grant.credentialId))) return refused('grant_not_found');
    const revoked = await tx
      .update(credentialGrants)
      .set({ revokedAt: entry.at })
      .where(and(eq(credentialGrants.id, grant.id), isNull(credentialGrants.revokedAt)))
      .returning({ id: credentialGrants.id });
    if (revoked.length === 0) return refused('grant_not_found');
    await recordAccess(tx, entry, { versionId: null, reason: null });
    return { ok: true };
  });
}
