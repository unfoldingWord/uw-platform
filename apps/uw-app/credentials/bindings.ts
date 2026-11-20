import { and, eq } from 'drizzle-orm';
import { connectorSchema, type Principal } from '@uw/contracts';
import type { CredentialBinding } from '@uw/core/acl';
import type { Database } from '@uw/db/client';
import { pgConstraint, pgErrorCode } from '@uw/db/errors';
import { credentialBindings, credentials } from '@uw/db/schema';
import { isId, locate } from './standing.ts';
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

const FOREIGN_KEY_VIOLATION = '23503';
const WORKFLOW_EXISTS = 'credential_bindings_harness_id_harnesses_id_fk';

const effectConnectors: ReadonlySet<string> = new Set(connectorSchema.exclude(['none']).options);

export type BindingChange = CredentialBinding & { readonly credentialId: string };

export type BindingOutcome = { readonly ok: true } | Refused;

type Change = {
  readonly binding: BindingChange;
  readonly personId: string;
  readonly entry: AccessEntry;
};

type Asked = Change | Refused;

const done = { versionId: null, reason: null } as const;

function where(binding: BindingChange) {
  return and(
    eq(credentialBindings.credentialId, binding.credentialId),
    eq(credentialBindings.harnessId, binding.harnessId),
    eq(credentialBindings.connectorKey, binding.connectorKey),
  );
}

async function asked(
  deps: CredentialsDeps,
  actor: Principal,
  action: 'bind' | 'unbind',
  input: { readonly binding: BindingChange; readonly traceId: string },
): Promise<Asked> {
  const { binding, traceId } = input;
  const { credentialId, harnessId, connectorKey } = binding;
  if (!effectConnectors.has(connectorKey)) return refused('connector_unknown');
  if (!isId(credentialId)) return refused('credential_not_found');
  if (!isId(harnessId)) return refused('workflow_not_found');
  const at = deps.clock.now();
  const found = await locate(deps.db, actor, credentialId, at);
  if (found === null) return refused('credential_not_found');
  const entry: AccessEntry = {
    credentialId,
    jdArea: found.jdArea,
    action,
    actor,
    usedBy: { harnessId, connectorKey },
    runId: null,
    traceId,
    at,
  };
  const personId = managerOf(actor, found, at);
  if (personId === null) return refuseUnpermitted(deps.db, entry, found);
  return { binding, personId, entry };
}

function workflowMissing(error: unknown): boolean {
  return pgErrorCode(error) === FOREIGN_KEY_VIOLATION && pgConstraint(error) === WORKFLOW_EXISTS;
}

async function addBinding(db: Database, change: Change): Promise<BindingOutcome> {
  const { binding, personId, entry } = change;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ revokedAt: credentials.revokedAt })
      .from(credentials)
      .where(eq(credentials.id, binding.credentialId))
      .for('update');
    if (locked === undefined || locked.revokedAt !== null) {
      return refuseAndRecord(tx, entry, { versionId: null, reason: 'credential_revoked' });
    }
    const added = await tx
      .insert(credentialBindings)
      .values({ ...binding, createdBy: personId, createdAt: entry.at })
      .onConflictDoNothing()
      .returning({ credentialId: credentialBindings.credentialId });
    if (added.length === 0) return refused('already_bound');
    await recordAccess(tx, entry, done);
    return { ok: true };
  });
}

export async function bindCredential(
  deps: CredentialsDeps,
  actor: Principal,
  binding: BindingChange,
  traceId: string,
): Promise<BindingOutcome> {
  const change = await asked(deps, actor, 'bind', { binding, traceId });
  if ('ok' in change) return change;
  try {
    return await addBinding(deps.db, change);
  } catch (error) {
    if (workflowMissing(error)) return refused('workflow_not_found');
    throw error;
  }
}

export async function unbindCredential(
  deps: CredentialsDeps,
  actor: Principal,
  binding: BindingChange,
  traceId: string,
): Promise<BindingOutcome> {
  const change = await asked(deps, actor, 'unbind', { binding, traceId });
  if ('ok' in change) return change;
  return deps.db.transaction(async (tx) => {
    const removed = await tx
      .delete(credentialBindings)
      .where(where(binding))
      .returning({ credentialId: credentialBindings.credentialId });
    if (removed.length === 0) return refused('not_bound');
    await recordAccess(tx, change.entry, done);
    return { ok: true };
  });
}
