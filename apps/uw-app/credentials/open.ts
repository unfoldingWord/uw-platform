import { and, desc, eq, isNotNull, isNull, not, or } from 'drizzle-orm';
import type { JdArea, Principal } from '@uw/contracts';
import { can, type CredentialBinding, type CredentialResource } from '@uw/core/acl';
import type { CredentialRefusal } from '@uw/core/credentials';
import type { Database } from '@uw/db/client';
import {
  credentialBindings,
  credentialGrants,
  credentials,
  credentialVersions,
} from '@uw/db/schema';
import { openValue, type SealedValue } from './envelope.ts';
import { isId, sees } from './standing.ts';
import {
  recordAccess,
  refuseAndRecord,
  refused,
  type AccessEntry,
  type CredentialsDeps,
  type Refused,
} from './store.ts';

export type OpenRequest =
  | {
      readonly action: 'use';
      readonly credentialId: string;
      readonly usedBy: CredentialBinding;
      readonly runId: string | null;
    }
  | { readonly action: 'reveal'; readonly credentialId: string };

export type OpenedCredential =
  | {
      readonly ok: true;
      readonly value: Uint8Array<ArrayBuffer>;
      readonly versionId: string;
      readonly version: number;
      readonly jdArea: JdArea;
    }
  | Refused;

type CurrentVersion = SealedValue & { readonly id: string; readonly version: number };

type Facts = {
  readonly resource: CredentialResource;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly current: CurrentVersion | null;
};

async function currentVersion(db: Database, credentialId: string): Promise<CurrentVersion | null> {
  const [row] = await db
    .select({
      id: credentialVersions.id,
      version: credentialVersions.version,
      cipher: credentialVersions.cipher,
      ciphertext: credentialVersions.ciphertext,
      nonce: credentialVersions.nonce,
      wrappedKey: credentialVersions.wrappedKey,
      keyId: credentialVersions.keyId,
    })
    .from(credentialVersions)
    .where(eq(credentialVersions.credentialId, credentialId))
    .orderBy(desc(credentialVersions.version))
    .limit(1);
  if (row === undefined) return null;
  return { ...row, cipher: row.cipher as SealedValue['cipher'] };
}

async function factsOf(db: Database, request: OpenRequest): Promise<Facts | null> {
  const { credentialId } = request;
  const [credential] = await db.select().from(credentials).where(eq(credentials.id, credentialId));
  if (credential === undefined) return null;
  const bindings = await db
    .select({
      harnessId: credentialBindings.harnessId,
      connectorKey: credentialBindings.connectorKey,
    })
    .from(credentialBindings)
    .where(eq(credentialBindings.credentialId, credentialId));
  const grants = await db
    .select({ personId: credentialGrants.personId, expiresAt: credentialGrants.expiresAt })
    .from(credentialGrants)
    .where(
      and(
        eq(credentialGrants.credentialId, credentialId),
        eq(credentialGrants.capability, 'reveal'),
        isNull(credentialGrants.revokedAt),
        or(not(credentialGrants.secondRequired), isNotNull(credentialGrants.secondBy)),
      ),
    );
  const resource: CredentialResource = {
    kind: 'credential',
    credentialId,
    area: credential.jdArea,
    bindings,
    usedBy: request.action === 'use' ? request.usedBy : null,
    revealGrants: grants.map((grant) => ({
      credentialId,
      personId: grant.personId,
      expiresAt: grant.expiresAt.toISOString(),
    })),
  };
  const { revokedAt, expiresAt } = credential;
  return { resource, revokedAt, expiresAt, current: await currentVersion(db, credentialId) };
}

function refusalOf(
  actor: Principal,
  request: OpenRequest,
  facts: Facts,
  at: Date,
): CredentialRefusal | null {
  if (!can(actor, request.action, facts.resource, at)) return 'not_permitted';
  if (facts.revokedAt !== null) return 'credential_revoked';
  if (facts.expiresAt !== null && facts.expiresAt.getTime() <= at.getTime()) {
    return 'credential_expired';
  }
  return facts.current === null ? 'envelope_malformed' : null;
}

export async function openCredential(
  deps: CredentialsDeps,
  actor: Principal,
  request: OpenRequest,
  traceId: string,
): Promise<OpenedCredential> {
  const at = deps.clock.now();
  const { credentialId } = request;
  const facts = isId(credentialId) ? await factsOf(deps.db, request) : null;
  if (facts === null) return refused('credential_not_found');
  const jdArea = facts.resource.area;
  const entry: AccessEntry = {
    credentialId,
    jdArea,
    action: request.action,
    actor,
    usedBy: facts.resource.usedBy,
    runId: request.action === 'use' ? request.runId : null,
    traceId,
    at,
  };
  const reason = refusalOf(actor, request, facts, at);
  const { current } = facts;
  if (reason !== null || current === null) {
    const refusal = { versionId: null, reason: reason ?? 'envelope_malformed' } as const;
    const answered = await refuseAndRecord(deps.db, entry, refusal);
    const hidden = request.action === 'reveal' && !sees(actor, { id: credentialId, jdArea }, at);
    return hidden ? refused('credential_not_found') : answered;
  }
  const versionId = current.id;
  const opened = await openValue(deps.keys, { credentialId, versionId, jdArea }, current);
  if (!opened.ok) return refuseAndRecord(deps.db, entry, { versionId, reason: opened.reason });
  await recordAccess(deps.db, entry, { versionId, reason: null });
  return { ok: true, value: opened.plaintext, versionId, version: current.version, jdArea };
}
