import { lt, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnyDatabase } from './any-database.ts';
import { declarationOf } from './declarations.ts';
import { closeEmbeddedTemplate } from './embedded.ts';
import { pgConstraint, pgErrorCode } from './errors.ts';
import * as schema from './schema.ts';
import { seedHarness, seedPerson } from './test-seed.ts';
import { databaseTargets, type DatabaseTarget, type OpenedDatabase } from './test-targets.ts';

afterAll(closeEmbeddedTemplate);

const admin = '00000000-0000-4000-8000-0000000157a1';
const reader = '00000000-0000-4000-8000-0000000157a2';
const harnessId = '00000000-0000-4000-8000-0000000157b1';
const stranger = '00000000-0000-4000-8000-0000000157ff';
const credential = '00000000-0000-4000-8000-0000000157c1';
const version = '00000000-0000-4000-8000-0000000157d1';
const trace = '00000000-0000-4000-8000-0000000157e1';
const atText = '2026-11-20T09:00:00.000Z';
const nonce = 'AAAAAAAAAAAAAAAA';
const blob = 'c2VhbGVk';

async function refusal(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return { code: pgErrorCode(error), constraint: pgConstraint(error) };
  }
  throw new Error('expected the database to refuse');
}

type CredentialRow = {
  readonly id: string;
  readonly name: string;
  readonly area?: string;
  readonly ref?: string | null;
  readonly kind?: string;
};

function addCredential(db: AnyDatabase, row: CredentialRow) {
  return db.execute(sql`INSERT INTO credentials
      (id, jd_area, jd_ref, name, kind, owner_id, created_by, created_at)
    VALUES (${row.id}, ${row.area ?? '20-29'}, ${row.ref ?? null}, ${row.name},
      ${row.kind ?? 'api_key'}, ${admin}, ${admin}, ${atText}::timestamptz)`);
}

type VersionRow = {
  readonly id: string;
  readonly version: number;
  readonly cipher?: string;
  readonly nonce?: string;
  readonly ciphertext?: string;
  readonly wrappedKey?: string;
};

function addVersion(db: AnyDatabase, row: VersionRow) {
  return db.execute(sql`INSERT INTO credential_versions
      (id, credential_id, version, cipher, ciphertext, nonce, wrapped_key, key_id,
       created_by, created_at)
    VALUES (${row.id}, ${credential}, ${row.version}, ${row.cipher ?? 'aes-256-gcm'},
      ${row.ciphertext ?? blob}, ${row.nonce ?? nonce}, ${row.wrappedKey ?? blob}, 'key-1',
      ${admin}, ${atText}::timestamptz)`);
}

function addGrant(db: AnyDatabase, capability: string, expiresAt: string | null) {
  return db.execute(sql`INSERT INTO credential_grants
      (credential_id, person_id, capability, granted_by, granted_at, expires_at)
    VALUES (${credential}, ${reader}, ${capability}, ${admin}, ${atText}::timestamptz,
      ${expiresAt}::timestamptz)`);
}

function addBinding(db: AnyDatabase, harness: string, connector: string) {
  return db.execute(sql`INSERT INTO credential_bindings
      (credential_id, harness_id, connector_key, created_by, created_at)
    VALUES (${credential}, ${harness}, ${connector}, ${admin}, ${atText}::timestamptz)`);
}

type LogRow = {
  readonly action?: string;
  readonly outcome?: string;
  readonly reason?: string | null;
  readonly actor?: string;
  readonly at?: string;
};

function addLog(db: AnyDatabase, row: LogRow = {}) {
  return db.execute(sql`INSERT INTO credential_access_log
      (credential_id, jd_area, action, outcome, reason, actor, person_id, trace_id, at)
    VALUES (${credential}, '20-29', ${row.action ?? 'use'}, ${row.outcome ?? 'done'},
      ${row.reason ?? null}, ${row.actor ?? `human:${admin}`}, ${admin}, ${trace},
      ${row.at ?? atText}::timestamptz)`);
}

function openDatabase(target: DatabaseTarget): () => AnyDatabase {
  let opened: OpenedDatabase | undefined;
  beforeAll(async () => {
    opened = await target.open();
    await seedPerson(opened.db, { id: admin, email: 'cred-admin@example.org' });
    await seedPerson(opened.db, { id: reader, email: 'cred-reader@example.org' });
    await seedHarness(opened.db, { id: harnessId, key: 'finance', jdArea: '20-29' });
    await addCredential(opened.db, { id: credential, name: 'Bank export' });
    await addVersion(opened.db, { id: version, version: 1 });
  }, 60_000);
  afterAll(() => opened?.close());
  return () => {
    if (!opened) throw new Error('the database did not open');
    return opened.db;
  };
}

function declarationRules(): void {
  it('declares the five tables sensitive or restricted, and never offline', () => {
    const declared = [
      schema.credentials,
      schema.credentialVersions,
      schema.credentialGrants,
      schema.credentialBindings,
      schema.credentialAccessLog,
    ].map(declarationOf);
    expect(declared).toEqual([
      { classification: 'sensitive', offlineEligibility: 'never' },
      { classification: 'sensitive', offlineEligibility: 'never' },
      { classification: 'restricted', offlineEligibility: 'never' },
      { classification: 'restricted', offlineEligibility: 'never' },
      { classification: 'sensitive', offlineEligibility: 'never' },
    ]);
  });

  it('gives credentials no column that could hold a value', () => {
    expect(Object.keys(schema.credentials).sort()).toEqual([
      'createdAt',
      'createdBy',
      'enableRLS',
      'expiresAt',
      'id',
      'jdArea',
      'jdRef',
      'kind',
      'name',
      'ownerId',
      'revokedAt',
      'rotateBy',
    ]);
  });
}

const second = '00000000-0000-4000-8000-0000000157c2';

function credentialRules(db: () => AnyDatabase): void {
  it('keeps a credential pinned to a category or an id inside its area', async () => {
    await addCredential(db(), { id: second, name: 'Monthly close portal', ref: '28' });
    await addCredential(db(), {
      id: '00000000-0000-4000-8000-0000000157c3',
      name: 'Ledger login',
      ref: '23.07',
    });
  });

  it.each([
    ['an area that is not a JD area', { area: '20-39' }, 'credentials_area_is_jd'],
    ['a pin outside its area', { ref: '43.27' }, 'credentials_ref_inside_area'],
    ['a pin that is not a category or an id', { ref: '2' }, 'credentials_ref_inside_area'],
    ['an unknown kind', { kind: 'cookie' }, 'credentials_kind_known'],
    ['a blank name', { name: ' ' }, 'credentials_name_trimmed'],
  ])('refuses %s', async (_name, change, constraint) => {
    const row = { id: '00000000-0000-4000-8000-0000000157c9', name: 'Refused', ...change };
    expect(await refusal(addCredential(db(), row))).toEqual({ code: '23514', constraint });
  });

  it('refuses a second credential of the same name in one area', async () => {
    const twin = { id: '00000000-0000-4000-8000-0000000157c8', name: 'Bank export' };
    expect(await refusal(addCredential(db(), twin))).toEqual({
      code: '23505',
      constraint: 'credentials_name_per_area',
    });
  });
}

function versionRules(db: () => AnyDatabase): void {
  const next = '00000000-0000-4000-8000-0000000157d2';

  it('adds a second version beside the first', async () => {
    await addVersion(db(), { id: next, version: 2 });
  });

  it('refuses the same version number twice', async () => {
    const twin = { id: '00000000-0000-4000-8000-0000000157d3', version: 2 };
    expect(await refusal(addVersion(db(), twin))).toEqual({
      code: '23505',
      constraint: 'credential_versions_once',
    });
  });

  it.each([
    ['a version below one', { version: 0 }, 'credential_versions_version_positive'],
    ['an unknown cipher', { cipher: 'aes-256-cbc' }, 'credential_versions_cipher_known'],
    ['a nonce that is not twelve bytes', { nonce: 'AAAA' }, 'credential_versions_nonce_length'],
    ['ciphertext that is not base64', { ciphertext: 'not base64!' }, 'credential_versions_sealed'],
    ['a wrapped key that is not base64', { wrappedKey: '' }, 'credential_versions_sealed'],
  ])('refuses %s', async (_name, change, constraint) => {
    const row = { id: '00000000-0000-4000-8000-0000000157d9', version: 9, ...change };
    expect(await refusal(addVersion(db(), row))).toEqual({ code: '23514', constraint });
  });

  it('refuses UPDATE, DELETE and TRUNCATE, so a version is only ever added', async () => {
    const changed = db().execute(sql`UPDATE credential_versions SET ciphertext = 'AAAA'`);
    const removed = db().execute(sql`DELETE FROM credential_versions`);
    const emptied = db().execute(sql`TRUNCATE credential_versions`);
    expect((await refusal(changed)).code).toBe('P0001');
    expect((await refusal(removed)).code).toBe('P0001');
    expect(['P0001', '0A000']).toContain((await refusal(emptied)).code);
  });
}

function grantRules(db: () => AnyDatabase): void {
  it('keeps a reveal grant that expires', async () => {
    await addGrant(db(), 'reveal', '2026-11-20T10:00:00.000Z');
  });

  it('refuses a reveal grant with no expiry', async () => {
    expect((await refusal(addGrant(db(), 'reveal', null))).code).toBe('23502');
  });

  it.each([
    ['a grant that expires before it is given', 'reveal', '2026-11-20T08:00:00.000Z'],
    ['a capability a grant cannot carry', 'manage', '2026-11-20T10:00:00.000Z'],
  ])('refuses %s', async (_name, capability, expiresAt) => {
    expect((await refusal(addGrant(db(), capability, expiresAt))).code).toBe('23514');
  });
}

function bindingRules(db: () => AnyDatabase): void {
  it('binds a credential to a workflow and a connector once', async () => {
    await addBinding(db(), harnessId, 'send');
    expect((await refusal(addBinding(db(), harnessId, 'send'))).code).toBe('23505');
  });

  it('refuses a workflow that does not exist', async () => {
    expect((await refusal(addBinding(db(), stranger, 'send'))).code).toBe('23503');
  });

  it.each(['none', 'ftp'])('refuses the connector %s', async (connector) => {
    expect(await refusal(addBinding(db(), harnessId, connector))).toEqual({
      code: '23514',
      constraint: 'credential_bindings_connector_known',
    });
  });
}

function oldRows(db: AnyDatabase) {
  const log = schema.credentialAccessLog;
  return db
    .select({ id: log.id })
    .from(log)
    .where(lt(log.at, new Date('2019-06-01T00:00:00.000Z')));
}

function logRules(db: () => AnyDatabase): void {
  it('records a use and a refusal with its reason', async () => {
    await addLog(db());
    await addLog(db(), { outcome: 'refused', reason: 'not_permitted', actor: 'agent:ingest' });
  });

  it.each([
    ['an unknown action', { action: 'peek' }, 'credential_access_log_action_known'],
    ['an unknown outcome', { outcome: 'maybe' }, 'credential_access_log_outcome_known'],
    ['a refusal with no reason', { outcome: 'refused' }, 'credential_access_log_reason_matches'],
    [
      'a reason on a use that went through',
      { reason: 'not_permitted' },
      'credential_access_log_reason_matches',
    ],
    [
      'a reason outside the closed set',
      { outcome: 'refused', reason: 'Error: socket hang up' },
      'credential_access_log_reason_matches',
    ],
    [
      'an actor that is not an identity',
      { actor: 'somebody' },
      'credential_access_log_actor_is_identity',
    ],
  ])('refuses %s', async (_name, change, constraint) => {
    expect(await refusal(addLog(db(), change))).toEqual({ code: '23514', constraint });
  });

  it('refuses UPDATE and TRUNCATE, and DELETE of a row younger than seven years', async () => {
    const changed = db().execute(sql`UPDATE credential_access_log SET actor = 'agent:ingest'`);
    const removed = db().execute(sql`DELETE FROM credential_access_log`);
    const emptied = db().execute(sql`TRUNCATE credential_access_log`);
    expect((await refusal(changed)).code).toBe('P0001');
    expect((await refusal(removed)).code).toBe('P0001');
    expect((await refusal(emptied)).code).toBe('P0001');
  });

  it('lets a row older than seven years be deleted', async () => {
    await addLog(db(), { at: '2019-01-01T00:00:00.000Z', action: 'reveal' });
    expect(await oldRows(db())).toHaveLength(1);
    await db().execute(
      sql`DELETE FROM credential_access_log WHERE at < '2019-06-01T00:00:00.000Z'::timestamptz`,
    );
    expect(await oldRows(db())).toHaveLength(0);
  });
}

function describeTarget(target: DatabaseTarget): void {
  const db = openDatabase(target);
  describe('credentials hold where a credential lives and never its value', () =>
    credentialRules(db));
  describe('credential_versions are append-only ciphertext', () => versionRules(db));
  describe('credential_grants hold reveal grants that always expire', () => grantRules(db));
  describe('credential_bindings name the workflow and connector of a use', () => bindingRules(db));
  describe('credential_access_log is append-only and kept seven years', () => logRules(db));
}

describe('#157 the credentials store tables', () => {
  declarationRules();
  describe.each(databaseTargets.map((target) => [target.name, target] as const))(
    'on the %s database',
    (_name, target) => describeTarget(target),
  );
});
