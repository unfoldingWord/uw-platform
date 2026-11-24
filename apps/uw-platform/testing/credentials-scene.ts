import { personPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import type { Clock } from '@uw/harness';
import { utf8 } from '../credentials/base64.ts';
import { personByEmail } from '../people/directory.ts';
import { createCredential } from '../credentials/store.ts';
import { memoryDataKeys } from '../credentials/testing/memory-data-keys.ts';

const traceId = '00000000-0000-4000-8000-0000000159e1';

export async function credentialFor(db: Database, email: string, clock: Clock): Promise<string> {
  const owner = await personByEmail(db, email);
  if (owner === null) throw new Error(`no person ${email}`);
  const grants = await resolveGrants(db, owner.personId, { at: clock.now() });
  const admin = personPrincipal({ personId: owner.personId, email, grants, interactive: true });
  const deps = { db, keys: await memoryDataKeys(), clock, newId: () => crypto.randomUUID() };
  const input = {
    jdArea: '80-89',
    jdRef: null,
    name: 'Release signing key',
    kind: 'ssh_key',
    ownerId: owner.personId,
    rotateBy: null,
    expiresAt: null,
    value: utf8('a sealed value no screen shows'),
  } as const;
  const outcome = await createCredential(deps, admin, input, traceId);
  if (!outcome.ok) throw new Error(`create was refused: ${outcome.reason}`);
  return outcome.credentialId;
}
