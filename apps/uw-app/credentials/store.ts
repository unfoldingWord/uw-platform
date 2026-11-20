import { eq, max } from 'drizzle-orm';
import { z } from 'zod';
import type { JdArea, Principal } from '@uw/contracts';
import { can, type CredentialBinding } from '@uw/core/acl';
import type {
  CredentialAccessAction,
  CredentialKind,
  CredentialRefusal,
} from '@uw/core/credentials';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { pgConstraint, pgErrorCode } from '@uw/db/errors';
import { credentialAccessLog, credentials, credentialVersions } from '@uw/db/schema';
import type { Clock } from '@uw/harness';
import type { DataKeys } from './data-keys.ts';
import { sealValue, type SealedValue } from './envelope.ts';
import { actorAsOf } from './live-actor.ts';
import { isId, locate, resourceOf, type Located } from './standing.ts';

export const owns = [
  'credentials',
  'credential_versions',
  'credential_grants',
  'credential_bindings',
  'credential_access_log',
] as const;

const VALUE_MAX_BYTES = 65_536;
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const NAME_PER_AREA = 'credentials_name_per_area';
const OWNER_EXISTS = 'credentials_owner_id_people_id_fk';
const NAME_MAX = 120;
const daySchema = z.iso.date();
const jdRefPattern = /^[0-9]{2}$|^[0-9]{2}\.[0-9]{2}$/;

export type CredentialsDeps = {
  readonly db: Database;
  readonly keys: DataKeys;
  readonly clock: Clock;
  readonly newId: () => string;
};

export type StoreRefusal =
  | CredentialRefusal
  | 'credential_not_found'
  | 'credential_name_taken'
  | 'connector_unknown'
  | 'workflow_not_found'
  | 'already_bound'
  | 'not_bound'
  | 'person_not_found'
  | 'grant_not_found'
  | 'grant_exists'
  | 'second_admin_required';

export type Refused = { readonly ok: false; readonly reason: StoreRefusal };

export type Written =
  | {
      readonly ok: true;
      readonly credentialId: string;
      readonly versionId: string;
      readonly version: number;
    }
  | Refused;

export type NewCredential = {
  readonly jdArea: JdArea;
  readonly jdRef: string | null;
  readonly name: string;
  readonly kind: CredentialKind;
  readonly ownerId: string;
  readonly rotateBy: string | null;
  readonly expiresAt: Date | null;
  readonly value: Uint8Array<ArrayBuffer>;
};

export type Rotation = {
  readonly credentialId: string;
  readonly value: Uint8Array<ArrayBuffer>;
  readonly rotateBy: string | null;
  readonly expiresAt: Date | null;
};

export type AccessEntry = {
  readonly credentialId: string;
  readonly jdArea: string;
  readonly action: CredentialAccessAction;
  readonly actor: Principal;
  readonly usedBy: CredentialBinding | null;
  readonly runId: string | null;
  readonly traceId: string;
  readonly at: Date;
};

type AccessResult = {
  readonly versionId: string | null;
  readonly reason: CredentialRefusal | null;
};

export function refused(reason: StoreRefusal): Refused {
  return { ok: false, reason };
}

export async function recordAccess(
  db: Executor,
  entry: AccessEntry,
  result: AccessResult,
): Promise<void> {
  await db.insert(credentialAccessLog).values({
    credentialId: entry.credentialId,
    versionId: result.versionId,
    jdArea: entry.jdArea,
    action: entry.action,
    outcome: result.reason === null ? 'done' : 'refused',
    reason: result.reason,
    actor: entry.actor.identity,
    personId: entry.actor.personId,
    harnessId: entry.usedBy?.harnessId ?? null,
    connectorKey: entry.usedBy?.connectorKey ?? null,
    runId: entry.runId,
    traceId: entry.traceId,
    at: entry.at,
  });
}

export async function refuseAndRecord(
  db: Executor,
  entry: AccessEntry,
  result: { readonly versionId: string | null; readonly reason: CredentialRefusal },
): Promise<Refused> {
  await recordAccess(db, entry, result);
  return refused(result.reason);
}

export function managerOf(
  actor: Principal,
  credential: { readonly id: string; readonly jdArea: JdArea },
  at: Date,
): string | null {
  return can(actor, 'manage', resourceOf(credential), at) ? actor.personId : null;
}

export async function refuseUnpermitted(
  db: Executor,
  entry: AccessEntry,
  located: Pick<Located, 'seen'>,
  hidden: 'credential_not_found' | 'grant_not_found' = 'credential_not_found',
): Promise<Refused> {
  await recordAccess(db, entry, { versionId: null, reason: 'not_permitted' });
  return refused(located.seen ? 'not_permitted' : hidden);
}

function dayOrNone(day: string | null): boolean {
  return day === null || daySchema.safeParse(day).success;
}

function wellFormed(input: NewCredential): boolean {
  const { name, jdRef, jdArea } = input;
  const named = name === name.trim() && name.length >= 1 && name.length <= NAME_MAX;
  const placed = jdRef === null || (jdRefPattern.test(jdRef) && jdRef[0] === jdArea[0]);
  return named && placed && isId(input.ownerId) && dayOrNone(input.rotateBy);
}

function storable(value: Uint8Array): boolean {
  return value.length >= 1 && value.length <= VALUE_MAX_BYTES;
}

function flawOf(input: Rotation): 'credential_malformed' | 'value_not_storable' | null {
  if (!dayOrNone(input.rotateBy)) return 'credential_malformed';
  return storable(input.value) ? null : 'value_not_storable';
}

type VersionRow = {
  readonly id: string;
  readonly credentialId: string;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: Date;
};

async function addVersion(tx: Transaction, row: VersionRow, sealed: SealedValue): Promise<void> {
  await tx.insert(credentialVersions).values({ ...row, ...sealed });
}

function nameTaken(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION && pgConstraint(error) === NAME_PER_AREA;
}

function ownerMissing(error: unknown): boolean {
  return pgErrorCode(error) === FOREIGN_KEY_VIOLATION && pgConstraint(error) === OWNER_EXISTS;
}

type Sealing = {
  readonly credentialId: string;
  readonly versionId: string;
  readonly personId: string;
  readonly sealed: SealedValue;
  readonly entry: AccessEntry;
};

async function insertCredential(
  deps: CredentialsDeps,
  input: NewCredential,
  made: Sealing,
): Promise<boolean> {
  const { credentialId, versionId, personId, sealed, entry } = made;
  return deps.db.transaction(async (tx) => {
    const at = deps.clock.now();
    const actor = await actorAsOf(tx, entry.actor, at);
    if (managerOf(actor, { id: credentialId, jdArea: input.jdArea }, at) === null) return false;
    await tx.insert(credentials).values({
      id: credentialId,
      jdArea: input.jdArea,
      jdRef: input.jdRef,
      name: input.name,
      kind: input.kind,
      ownerId: input.ownerId,
      rotateBy: input.rotateBy,
      expiresAt: input.expiresAt,
      createdBy: personId,
      createdAt: entry.at,
    });
    const row = { id: versionId, credentialId, version: 1, createdBy: personId };
    await addVersion(tx, { ...row, createdAt: entry.at }, sealed);
    await recordAccess(tx, entry, { versionId, reason: null });
    return true;
  });
}

export async function createCredential(
  deps: CredentialsDeps,
  actor: Principal,
  input: NewCredential,
  traceId: string,
): Promise<Written> {
  const at = deps.clock.now();
  const [credentialId, versionId] = [deps.newId(), deps.newId()];
  const { jdArea } = input;
  const personId = managerOf(actor, { id: credentialId, jdArea }, at);
  if (personId === null) return refused('not_permitted');
  if (!wellFormed(input)) return refused('credential_malformed');
  if (!storable(input.value)) return refused('value_not_storable');
  const sealed = await sealValue(deps.keys, { credentialId, versionId, jdArea }, input.value);
  if (!sealed.ok) return refused(sealed.reason);
  const entry: AccessEntry = {
    credentialId,
    jdArea,
    action: 'create',
    actor,
    usedBy: null,
    runId: null,
    traceId,
    at,
  };
  const made = { ...sealed, credentialId, versionId, personId, entry };
  try {
    if (!(await insertCredential(deps, input, made))) return refused('not_permitted');
  } catch (error) {
    if (nameTaken(error)) return refused('credential_name_taken');
    if (ownerMissing(error)) return refused('person_not_found');
    throw error;
  }
  return { ok: true, credentialId, versionId, version: 1 };
}

async function nextVersion(tx: Transaction, credentialId: string): Promise<number> {
  const [row] = await tx
    .select({ latest: max(credentialVersions.version) })
    .from(credentialVersions)
    .where(eq(credentialVersions.credentialId, credentialId));
  return (row?.latest ?? 0) + 1;
}

async function addRotation(
  deps: CredentialsDeps,
  input: Rotation,
  made: Sealing,
): Promise<Written> {
  const { credentialId, versionId, personId, sealed, entry } = made;
  return deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: credentials.id, jdArea: credentials.jdArea, revokedAt: credentials.revokedAt })
      .from(credentials)
      .where(eq(credentials.id, credentialId))
      .for('update');
    if (locked === undefined) return refused('credential_not_found');
    const at = deps.clock.now();
    if (managerOf(await actorAsOf(tx, entry.actor, at), locked, at) === null) {
      return refuseAndRecord(tx, entry, { versionId: null, reason: 'not_permitted' });
    }
    if (locked.revokedAt !== null) {
      return refuseAndRecord(tx, entry, { versionId: null, reason: 'credential_revoked' });
    }
    const version = await nextVersion(tx, credentialId);
    const row = { id: versionId, credentialId, version, createdBy: personId };
    await addVersion(tx, { ...row, createdAt: entry.at }, sealed);
    await tx
      .update(credentials)
      .set({ rotateBy: input.rotateBy, expiresAt: input.expiresAt })
      .where(eq(credentials.id, credentialId));
    await recordAccess(tx, entry, { versionId, reason: null });
    return { ok: true, credentialId, versionId, version };
  });
}

export async function rotateCredential(
  deps: CredentialsDeps,
  actor: Principal,
  input: Rotation,
  traceId: string,
): Promise<Written> {
  const at = deps.clock.now();
  const { credentialId } = input;
  const found = await locate(deps.db, actor, credentialId, at);
  if (found === null) return refused('credential_not_found');
  const { jdArea } = found;
  const entry: AccessEntry = {
    credentialId,
    jdArea,
    action: 'rotate',
    actor,
    usedBy: null,
    runId: null,
    traceId,
    at,
  };
  const unsealed = { versionId: null };
  const personId = managerOf(actor, found, at);
  if (personId === null) return refuseUnpermitted(deps.db, entry, found);
  if (found.revokedAt !== null) {
    return refuseAndRecord(deps.db, entry, { ...unsealed, reason: 'credential_revoked' });
  }
  const flaw = flawOf(input);
  if (flaw !== null) return refuseAndRecord(deps.db, entry, { ...unsealed, reason: flaw });
  const versionId = deps.newId();
  const sealed = await sealValue(deps.keys, { credentialId, versionId, jdArea }, input.value);
  if (!sealed.ok) return refuseAndRecord(deps.db, entry, { ...unsealed, reason: sealed.reason });
  return addRotation(deps, input, { ...sealed, credentialId, versionId, personId, entry });
}
