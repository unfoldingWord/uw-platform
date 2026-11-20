import type { Principal } from '@uw/contracts';
import { personPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { resolveGrants } from '@uw/db/store';
import type { Clock } from '@uw/harness';
import { utf8 } from '../credentials/base64.ts';
import { bindCredential } from '../credentials/bindings.ts';
import { giveRevealGrant } from '../credentials/reveal-grants.ts';
import { revokeCredential } from '../credentials/revoke.ts';
import { personByEmail } from '../people/directory.ts';
import { createCredential, type CredentialsDeps } from '../credentials/store.ts';
import { memoryDataKeys } from '../credentials/testing/memory-data-keys.ts';
import { cast, seedCast, workflowId } from './credentials-app.ts';

const traceId = '00000000-0000-4000-8000-0000000159e1';
const DAY_MINUTES = 1440;

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

export type CredentialsScene = { readonly bankExport: string };

type Member = { readonly id: string; readonly email: string };

async function principalOf(db: Database, member: Member, at: Date): Promise<Principal> {
  const { id, email } = member;
  const grants = await resolveGrants(db, id, { at });
  return personPrincipal({ personId: id, email, grants, interactive: true });
}

type Making = { readonly deps: CredentialsDeps; readonly admin: Principal };

async function made(
  making: Making,
  name: string,
  kind: 'api_key' | 'password' | 'certificate',
  rotateBy: string | null,
): Promise<string> {
  const input = {
    jdArea: '20-29',
    jdRef: kind === 'api_key' ? '28' : null,
    name,
    kind,
    ownerId: cast.editor.id,
    rotateBy,
    expiresAt: null,
    value: utf8('a sealed value no picture shows'),
  };
  const outcome = await createCredential(making.deps, making.admin, input, traceId);
  if (!outcome.ok) throw new Error(`create was refused: ${outcome.reason}`);
  return outcome.credentialId;
}

export async function credentialsScene(db: Database, clock: Clock): Promise<CredentialsScene> {
  await seedCast(db);
  const at = clock.now();
  const deps = { db, keys: await memoryDataKeys(), clock, newId: () => crypto.randomUUID() };
  const admin = await principalOf(db, cast.admin, at);
  const making = { deps, admin };
  const bankExport = await made(making, 'Bank export key', 'api_key', '2027-02-01');
  await made(making, 'Funder portal login', 'password', '2026-09-01');
  const retired = await made(making, 'Old payroll certificate', 'certificate', null);
  await revokeCredential(deps, admin, retired, traceId);
  const binding = { credentialId: bankExport, harnessId: workflowId, connectorKey: 'send' };
  await bindCredential(deps, admin, binding, traceId);
  const toViewer = { credentialId: bankExport, personId: cast.viewer.id, minutes: DAY_MINUTES };
  await giveRevealGrant(deps, admin, toViewer, traceId);
  const second = await principalOf(db, cast.second, at);
  const toSecond = { credentialId: bankExport, personId: cast.second.id, minutes: DAY_MINUTES };
  await giveRevealGrant(deps, second, toSecond, traceId);
  const editor = await principalOf(db, cast.editor, at);
  await revokeCredential(deps, editor, bankExport, traceId);
  return { bankExport };
}
