import { eq, sql } from 'drizzle-orm';
import type { Grant, Principal } from '@uw/contracts';
import { parsePrincipal, personPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { credentialBindings, credentialGrants, credentials } from '@uw/db/schema';
import { utf8 } from '../base64.ts';
import type { CredentialsDeps, NewCredential } from '../store.ts';
import { memoryDataKeys, type MemoryDataKeys } from './memory-data-keys.ts';

export const now = new Date('2026-11-20T09:00:00.000Z');
export const traceId = '00000000-0000-4000-8000-0000000157e1';
export const runId = '00000000-0000-4000-8000-0000000157e2';
export const harnessId = '00000000-0000-4000-8000-0000000157b1';
export const otherHarnessId = '00000000-0000-4000-8000-0000000157b2';
export const people = {
  admin: '00000000-0000-4000-8000-0000000157a1',
  editor: '00000000-0000-4000-8000-0000000157a2',
  viewer: '00000000-0000-4000-8000-0000000157a3',
  orgAdmin: '00000000-0000-4000-8000-0000000157a4',
  outsider: '00000000-0000-4000-8000-0000000157a5',
} as const;

type Who = keyof typeof people;

function grant(role: Grant['role'], area: string | null): Grant {
  const base = { grantId: '00000000-0000-4000-8000-000000015701', role, expiresAt: null };
  if (area === null) return { ...base, scopeKind: 'org', scopeArea: null };
  return { ...base, scopeKind: 'jd_area', scopeArea: area };
}

type Cast = { readonly id: string; readonly email: string; readonly grant: Grant };

const cast: ReadonlyMap<Who, Cast> = new Map<Who, Cast>([
  ['admin', { id: people.admin, email: 'cred-admin@example.org', grant: grant('admin', '20-29') }],
  [
    'editor',
    { id: people.editor, email: 'cred-editor@example.org', grant: grant('editor', '20-29') },
  ],
  [
    'viewer',
    { id: people.viewer, email: 'cred-viewer@example.org', grant: grant('viewer', '20-29') },
  ],
  [
    'orgAdmin',
    { id: people.orgAdmin, email: 'cred-org-admin@example.org', grant: grant('admin', null) },
  ],
  [
    'outsider',
    { id: people.outsider, email: 'cred-outsider@example.org', grant: grant('admin', '80-89') },
  ],
]);

function member(who: Who): Cast {
  const found = cast.get(who);
  if (found === undefined) throw new Error(`no test person ${who}`);
  return found;
}

export function person(who: Who, grants?: readonly Grant[]): Principal {
  const { id, email, grant: held } = member(who);
  return personPrincipal({ personId: id, email, grants: grants ?? [held], interactive: true });
}

export function orgEditor(): Principal {
  return person('outsider', [grant('editor', null)]);
}

export function secondOrgAdmin(): Principal {
  return person('outsider', [grant('admin', null)]);
}

export function agentOf(who: Who): Principal {
  const { id, grant: held } = member(who);
  return parsePrincipal({
    identity: `agent:${id}/laptop`,
    kind: 'agent',
    personId: id,
    email: null,
    grants: [held],
    interactive: false,
  });
}

export { utf8 as bytes } from '../base64.ts';

export function textOf(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

export type World = {
  readonly deps: CredentialsDeps;
  readonly keys: MemoryDataKeys;
  input(name: string, value?: string): NewCredential;
};

export const seededPeople: readonly { readonly id: string; readonly email: string }[] = [
  ...cast.values(),
].map(({ id, email }) => ({ id, email }));

const grantIds: ReadonlyMap<Who, string> = new Map<Who, string>([
  ['admin', '00000000-0000-4000-8000-0000000158a1'],
  ['editor', '00000000-0000-4000-8000-0000000158a2'],
  ['viewer', '00000000-0000-4000-8000-0000000158a3'],
  ['orgAdmin', '00000000-0000-4000-8000-0000000158a4'],
  ['outsider', '00000000-0000-4000-8000-0000000158a5'],
]);

export function grantIdOf(who: Who): string {
  const found = grantIds.get(who);
  if (found === undefined) throw new Error(`no test grant for ${who}`);
  return found;
}

export const seededGrants = [...cast.entries()].map(([who, { id, grant: held }]) => ({
  id: grantIdOf(who),
  personId: id,
  role: held.role,
  scopeKind: held.scopeKind,
  scopeArea: held.scopeArea,
  grantedAt: new Date('2026-11-01T09:00:00.000Z'),
  expiresAt: null,
}));

export async function worldOn(db: Database): Promise<World> {
  const keys = await memoryDataKeys();
  return {
    keys,
    deps: { db, keys, clock: { now: () => new Date(now) }, newId: () => crypto.randomUUID() },
    input: (name, value = `value of ${name}`) => ({
      jdArea: '20-29',
      jdRef: null,
      name,
      kind: 'api_key',
      ownerId: people.admin,
      rotateBy: null,
      expiresAt: null,
      value: utf8(value),
    }),
  };
}

export async function bind(db: Database, credentialId: string, harness = harnessId) {
  await db.insert(credentialBindings).values({
    credentialId,
    harnessId: harness,
    connectorKey: 'send',
    createdBy: people.admin,
    createdAt: now,
  });
}

type Reveal = { readonly expiresAt: Date; readonly revokedAt?: Date };

export type GrantRow = {
  readonly id: string;
  readonly person_id: string;
  readonly granted_by: string;
  readonly second_required: boolean;
  readonly second_by: string | null;
  readonly revoked: boolean;
  readonly minutes: number;
};

export async function grantsOf(db: Database, credentialId: string): Promise<GrantRow[]> {
  const rows = await db.execute<GrantRow>(
    sql`SELECT id, person_id, granted_by, second_required, second_by,
          revoked_at IS NOT NULL AS revoked,
          (extract(epoch FROM expires_at - coalesce(second_at, granted_at)) / 60)::int AS minutes
        FROM credential_grants WHERE credential_id = ${credentialId} ORDER BY granted_at, id`,
  );
  return [...rows];
}

export async function grantReveal(db: Database, credentialId: string, who: Who, reveal: Reveal) {
  await db.insert(credentialGrants).values({
    credentialId,
    personId: member(who).id,
    capability: 'reveal',
    grantedBy: people.admin,
    grantedAt: new Date('2026-11-19T09:00:00.000Z'),
    expiresAt: reveal.expiresAt,
    revokedAt: reveal.revokedAt ?? null,
  });
}

export async function rewrite(
  db: Database,
  credentialId: string,
  change: Partial<typeof credentials.$inferInsert>,
) {
  await db.update(credentials).set(change).where(eq(credentials.id, credentialId));
}

export type Logged = {
  readonly action: string;
  readonly outcome: string;
  readonly reason: string | null;
  readonly actor: string;
  readonly person_id: string | null;
  readonly version_id: string | null;
  readonly harness_id: string | null;
  readonly connector_key: string | null;
  readonly run_id: string | null;
  readonly trace_id: string;
};

export async function logOf(db: Database, credentialId: string): Promise<Logged[]> {
  const rows = await db.execute<Logged>(
    sql`SELECT action, outcome, reason, actor, person_id, version_id, harness_id, connector_key,
          run_id, trace_id
        FROM credential_access_log WHERE credential_id = ${credentialId} ORDER BY position`,
  );
  return [...rows];
}

export async function dump(db: Database): Promise<string> {
  const tables = [
    'credentials',
    'credential_versions',
    'credential_grants',
    'credential_bindings',
    'credential_access_log',
  ];
  const parts: string[] = [];
  for (const table of tables) {
    const rows = await db.execute<{ row: string }>(
      sql`SELECT row_to_json(t)::text AS row FROM ${sql.identifier(table)} t`,
    );
    parts.push(...[...rows].map((entry) => entry.row));
  }
  return parts.join('\n');
}

export async function counts(db: Database): Promise<Record<string, number>> {
  const rows = await db.execute<{ c: number; v: number; l: number }>(
    sql`SELECT (SELECT count(*)::int FROM credentials) AS c,
          (SELECT count(*)::int FROM credential_versions) AS v,
          (SELECT count(*)::int FROM credential_access_log) AS l`,
  );
  const [row] = [...rows];
  return { credentials: row?.c ?? -1, versions: row?.v ?? -1, log: row?.l ?? -1 };
}
