import { z } from 'zod';
import type { Principal } from '@uw/contracts';
import type { CredentialBinding } from '@uw/core/acl';
import type { Database } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import { personById } from '../people/directory.ts';
import { openCredential } from './open.ts';
import { outcomeCarries } from './outcome-guard.ts';
import { secretOf, spendSecret, type Secret } from './secret.ts';
import { refused, type CredentialsDeps, type StoreRefusal } from './store.ts';

type CredentialRef = { readonly credentialId: string };

export type CredentialUse = {
  readonly actor: Principal;
  readonly ref: CredentialRef;
  readonly usedBy: CredentialBinding;
  readonly runId: string | null;
  readonly traceId: string;
};

type UseRefusal = StoreRefusal | 'connector_failed' | 'value_in_outcome';

export type Used<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: UseRefusal };

export type CredentialedCall<T> = (secret: Secret<string>) => Promise<T>;

const refSchema = z.strictObject({ credentialId: z.uuid() });

async function runPersonOf(db: Database, actor: Principal, at: Date): Promise<Principal> {
  const nobody = { ...actor, grants: [] };
  if (actor.personId === null) return nobody;
  const found = await personById(db, actor.personId);
  if (found?.status !== 'active') return nobody;
  return { ...actor, grants: await resolveGrants(db, actor.personId, { at }) };
}

async function called<T>(
  call: CredentialedCall<T>,
  value: Uint8Array<ArrayBuffer>,
): Promise<Used<T>> {
  const secret = secretOf(value);
  try {
    const outcome = await call(secret);
    if (outcomeCarries(outcome, value)) return { ok: false, reason: 'value_in_outcome' };
    return { ok: true, value: outcome };
  } catch {
    return { ok: false, reason: 'connector_failed' };
  } finally {
    spendSecret(secret);
  }
}

export async function useCredential<T>(
  deps: CredentialsDeps,
  use: CredentialUse,
  call: CredentialedCall<T>,
): Promise<Used<T>> {
  const ref = refSchema.safeParse(use.ref);
  if (!ref.success) return refused('credential_not_found');
  const person = await runPersonOf(deps.db, use.actor, deps.clock.now());
  const { usedBy, runId } = use;
  const request = { action: 'use', credentialId: ref.data.credentialId, usedBy, runId } as const;
  const opened = await openCredential(deps, person, request, use.traceId);
  if (!opened.ok) return opened;
  return called(call, opened.value);
}
