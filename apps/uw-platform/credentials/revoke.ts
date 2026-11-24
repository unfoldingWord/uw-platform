import { eq } from 'drizzle-orm';
import type { Principal } from '@uw/contracts';
import { credentials } from '@uw/db/schema';
import { locate } from './standing.ts';
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

export type Revoked = { readonly ok: true } | Refused;

export async function revokeCredential(
  deps: CredentialsDeps,
  actor: Principal,
  credentialId: string,
  traceId: string,
): Promise<Revoked> {
  const at = deps.clock.now();
  const found = await locate(deps.db, actor, credentialId, at);
  if (found === null) return refused('credential_not_found');
  const entry: AccessEntry = {
    credentialId,
    jdArea: found.jdArea,
    action: 'revoke',
    actor,
    usedBy: null,
    runId: null,
    traceId,
    at,
  };
  if (managerOf(actor, found, at) === null) return refuseUnpermitted(deps.db, entry, found);
  return deps.db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ revokedAt: credentials.revokedAt })
      .from(credentials)
      .where(eq(credentials.id, credentialId))
      .for('update');
    if (locked === undefined || locked.revokedAt !== null) {
      return refuseAndRecord(tx, entry, { versionId: null, reason: 'credential_revoked' });
    }
    await tx.update(credentials).set({ revokedAt: at }).where(eq(credentials.id, credentialId));
    await recordAccess(tx, entry, { versionId: null, reason: null });
    return { ok: true };
  });
}
