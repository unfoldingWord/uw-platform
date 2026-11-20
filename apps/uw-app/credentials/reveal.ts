import type { Principal } from '@uw/contracts';
import { openCredential } from './open.ts';
import { refused, type CredentialsDeps, type Refused } from './store.ts';
import type { Tell } from './tell-admins.ts';

export type RevealDeps = CredentialsDeps & { readonly tell: Tell };

export type Revealed = { readonly ok: true; readonly value: string } | Refused;

function textOf(value: Uint8Array<ArrayBuffer>): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value);
  } catch {
    return null;
  }
}

export async function revealCredential(
  deps: RevealDeps,
  actor: Principal,
  credentialId: string,
  traceId: string,
): Promise<Revealed> {
  const opened = await openCredential(deps, actor, { action: 'reveal', credentialId }, traceId);
  if (!opened.ok) return opened;
  const value = textOf(opened.value);
  opened.value.fill(0);
  await deps.tell({
    credentialId,
    jdArea: opened.jdArea,
    revealedBy: actor.personId,
    at: deps.clock.now(),
  });
  if (value === null) return refused('value_not_storable');
  return { ok: true, value };
}
