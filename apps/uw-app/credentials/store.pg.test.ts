import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Database } from '@uw/db/client';
import { createMigratedDatabase, testServer, type TestDatabase } from '@uw/db/test-database';
import { seedHarness, seedPerson } from '@uw/db/test-seed';
import { toBase64 } from './base64.ts';
import type { DataKeys } from './data-keys.ts';
import { openCredential } from './open.ts';
import { createCredential, rotateCredential } from './store.ts';
import { memoryDataKeys } from './testing/memory-data-keys.ts';
import {
  agentOf,
  bind,
  bytes,
  counts,
  dump,
  grantReveal,
  harnessId,
  logOf,
  now,
  orgEditor,
  otherHarnessId,
  people,
  person,
  rewrite,
  runId,
  seededPeople,
  textOf,
  traceId,
  worldOn,
  type World,
} from './testing/store-world.ts';

let database: TestDatabase;
let db: Database;
let world: World;

const send = { harnessId, connectorKey: 'send' } as const;
const soon = new Date('2026-11-20T10:00:00.000Z');
const past = new Date('2026-11-20T08:00:00.000Z');

async function created(name: string, value?: string): Promise<string> {
  const outcome = await createCredential(
    world.deps,
    person('admin'),
    world.input(name, value),
    traceId,
  );
  if (!outcome.ok) throw new Error(`create was refused: ${outcome.reason}`);
  return outcome.credentialId;
}

function use(
  credentialId: string,
  usedBy: typeof send | { harnessId: string; connectorKey: string } = send,
) {
  return { action: 'use', credentialId, usedBy, runId } as const;
}

function creating(): void {
  it('lets an area admin create a credential: one row, version 1, one log entry', async () => {
    const before = await counts(db);
    const outcome = await createCredential(
      world.deps,
      person('admin'),
      world.input('Bank export'),
      traceId,
    );
    expect(outcome).toMatchObject({ ok: true, version: 1 });
    expect(await counts(db)).toEqual({
      credentials: (before['credentials'] ?? 0) + 1,
      versions: (before['versions'] ?? 0) + 1,
      log: (before['log'] ?? 0) + 1,
    });
    const id = outcome.ok ? outcome.credentialId : '';
    expect(await logOf(db, id)).toEqual([
      {
        action: 'create',
        outcome: 'done',
        reason: null,
        actor: `human:${people.admin}`,
        person_id: people.admin,
        version_id: outcome.ok ? outcome.versionId : null,
        harness_id: null,
        connector_key: null,
        run_id: null,
        trace_id: traceId,
      },
    ]);
  });

  it('lets an org admin create one in any area', async () => {
    const outcome = await createCredential(
      world.deps,
      person('orgAdmin'),
      world.input('Created by an org admin'),
      traceId,
    );
    expect(outcome.ok).toBe(true);
  });
}

function refusingCreation(): void {
  it.each([
    ['an editor on the area', () => person('editor')],
    ['an admin of another area', () => person('outsider')],
    ['an org editor', orgEditor],
    ['an agent carrying an area admin grant', () => agentOf('admin')],
  ])('refuses %s, and writes nothing', async (_name, actor) => {
    const before = await counts(db);
    const outcome = await createCredential(world.deps, actor(), world.input('Refused'), traceId);
    expect(outcome).toEqual({ ok: false, reason: 'not_permitted' });
    expect(await counts(db)).toEqual(before);
  });

  it('refuses a second credential of the same name in the area', async () => {
    await created('Twice');
    const again = await createCredential(
      world.deps,
      person('admin'),
      world.input('Twice'),
      traceId,
    );
    expect(again).toEqual({ ok: false, reason: 'credential_name_taken' });
  });

  it.each([
    ['an empty value', new Uint8Array(0)],
    ['a value over 64 KiB', new Uint8Array(65_537)],
  ])('refuses %s', async (_name, value) => {
    const input = { ...world.input('Unstorable'), value };
    expect(await createCredential(world.deps, person('admin'), input, traceId)).toEqual({
      ok: false,
      reason: 'value_not_storable',
    });
  });

  it('writes nothing when the key service cannot be reached', async () => {
    const before = await counts(db);
    world.keys.failNext('key_service_unavailable');
    const outcome = await createCredential(
      world.deps,
      person('admin'),
      world.input('No key service'),
      traceId,
    );
    expect(outcome).toEqual({ ok: false, reason: 'key_service_unavailable' });
    expect(await counts(db)).toEqual(before);
  });
}

function dumping(): void {
  it('holds neither the value nor any data key in a dump of the five tables', async () => {
    const dataKeys: string[] = [];
    const recording: DataKeys = {
      generate: async (context) => {
        const outcome = await world.keys.generate(context);
        if (outcome.ok) dataKeys.push(toBase64(outcome.value.plaintext));
        return outcome;
      },
      unwrap: (key, context) => world.keys.unwrap(key, context),
    };
    const value = 'portal-password: correct horse battery staple 157';
    const outcome = await createCredential(
      { ...world.deps, keys: recording },
      person('admin'),
      world.input('Dumped', value),
      traceId,
    );
    expect(outcome.ok).toBe(true);
    const rows = await dump(db);
    expect(rows).toContain('Dumped');
    expect(rows).not.toContain(value);
    expect(rows).not.toContain(toBase64(bytes(value)));
    expect(dataKeys).toHaveLength(1);
    expect(rows).not.toContain(dataKeys[0]);
  });

  it('decrypts nothing from the rows alone: without the key-encryption key every open is refused', async () => {
    const id = await created('Stolen rows');
    await grantReveal(db, id, 'viewer', { expiresAt: soon });
    const withoutTheKey = { ...world.deps, keys: await memoryDataKeys() };
    const reveal = { action: 'reveal', credentialId: id } as const;
    expect(await openCredential(withoutTheKey, person('viewer'), reveal, traceId)).toEqual({
      ok: false,
      reason: 'key_rejected',
    });
    const opened = await openCredential(world.deps, person('viewer'), reveal, traceId);
    expect(opened.ok && textOf(opened.value)).toBe('value of Stolen rows');
  });
}

function movedRows(): void {
  it('refuses a credential whose row was moved to another area, whoever asks', async () => {
    const id = await created('Moved');
    await grantReveal(db, id, 'outsider', { expiresAt: soon });
    await rewrite(db, id, { jdArea: '80-89' });
    const reveal = { action: 'reveal', credentialId: id } as const;
    expect(await openCredential(world.deps, person('outsider'), reveal, traceId)).toEqual({
      ok: false,
      reason: 'key_rejected',
    });
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      action: 'reveal',
      outcome: 'refused',
      reason: 'key_rejected',
    });
  });
}

function rotating(): void {
  it('adds a version, leaves the old one as it was, and opens to the new value', async () => {
    const id = await created('Rotated', 'first value');
    await bind(db, id);
    const before = await db.execute(
      sql`SELECT * FROM credential_versions WHERE credential_id = ${id}`,
    );
    const rotated = await rotateCredential(
      world.deps,
      person('admin'),
      { credentialId: id, value: bytes('second value'), rotateBy: '2027-05-01', expiresAt: null },
      traceId,
    );
    expect(rotated).toMatchObject({ ok: true, version: 2 });
    const after = await db.execute(
      sql`SELECT * FROM credential_versions WHERE credential_id = ${id} ORDER BY version`,
    );
    expect([...after]).toHaveLength(2);
    expect([...after][0]).toEqual([...before][0]);
    const opened = await openCredential(world.deps, person('editor'), use(id), traceId);
    expect(opened).toMatchObject({ ok: true, version: 2 });
    expect(opened.ok && textOf(opened.value)).toBe('second value');
    expect((await logOf(db, id)).map((entry) => entry.action)).toEqual(['create', 'rotate', 'use']);
  });

  it('gives two rotations at once the versions 2 and 3', async () => {
    const id = await created('Raced');
    const rotate = (value: string) =>
      rotateCredential(
        world.deps,
        person('admin'),
        { credentialId: id, value: bytes(value), rotateBy: null, expiresAt: null },
        traceId,
      );
    const outcomes = await Promise.all([rotate('a'), rotate('b')]);
    expect(outcomes.map((outcome) => outcome.ok && outcome.version).sort()).toEqual([2, 3]);
  });
}

function refusingRotation(): void {
  it('refuses an editor, and records the refusal', async () => {
    const id = await created('Not rotated');
    const outcome = await rotateCredential(
      world.deps,
      person('editor'),
      { credentialId: id, value: bytes('x'), rotateBy: null, expiresAt: null },
      traceId,
    );
    expect(outcome).toEqual({ ok: false, reason: 'not_permitted' });
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      action: 'rotate',
      outcome: 'refused',
      reason: 'not_permitted',
      actor: `human:${people.editor}`,
    });
  });

  it('refuses a revoked credential and one that does not exist', async () => {
    const id = await created('Revoked before rotation');
    await rewrite(db, id, { revokedAt: past });
    const input = { value: bytes('x'), rotateBy: null, expiresAt: null };
    expect(
      await rotateCredential(world.deps, person('admin'), { credentialId: id, ...input }, traceId),
    ).toEqual({ ok: false, reason: 'credential_revoked' });
    expect(
      await rotateCredential(
        world.deps,
        person('admin'),
        { credentialId: crypto.randomUUID(), ...input },
        traceId,
      ),
    ).toEqual({ ok: false, reason: 'credential_not_found' });
  });
}

function using(): void {
  it('opens for an editor on the area where the credential is bound, and records the use', async () => {
    const id = await created('Used', 'the used value');
    await bind(db, id);
    const opened = await openCredential(world.deps, person('editor'), use(id), traceId);
    expect(opened.ok && textOf(opened.value)).toBe('the used value');
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      action: 'use',
      outcome: 'done',
      reason: null,
      actor: `human:${people.editor}`,
      person_id: people.editor,
      version_id: opened.ok ? opened.versionId : null,
      harness_id: harnessId,
      connector_key: 'send',
      run_id: runId,
    });
  });

  it("opens for an agent carrying its person's editor grant, and records the agent as the actor", async () => {
    const id = await created('Used by an agent');
    await bind(db, id);
    const opened = await openCredential(world.deps, agentOf('editor'), use(id), traceId);
    expect(opened.ok).toBe(true);
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      action: 'use',
      outcome: 'done',
      actor: `agent:${people.editor}/laptop`,
      person_id: people.editor,
    });
  });
}

function refusingUse(): void {
  it.each([
    ['a viewer on the area', () => person('viewer'), send],
    ['an org admin', () => person('orgAdmin'), send],
    ['an editor of another area', () => person('outsider'), send],
    [
      'an editor from a workflow it is not bound to',
      () => person('editor'),
      { harnessId: otherHarnessId, connectorKey: 'send' },
    ],
    [
      'an editor through a connector it is not bound to',
      () => person('editor'),
      { harnessId, connectorKey: 'post' },
    ],
  ])('refuses %s, and records the refusal', async (_name, actor, usedBy) => {
    const id = await created(`Refused use ${crypto.randomUUID()}`);
    await bind(db, id);
    const outcome = await openCredential(world.deps, actor(), use(id, usedBy), traceId);
    expect(outcome).toEqual({ ok: false, reason: 'not_permitted' });
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      action: 'use',
      outcome: 'refused',
      reason: 'not_permitted',
      harness_id: usedBy.harnessId,
      connector_key: usedBy.connectorKey,
    });
  });

  it('refuses a revoked credential and an expired one, by name', async () => {
    const revoked = await created('Revoked');
    const expired = await created('Expired');
    await bind(db, revoked);
    await bind(db, expired);
    await rewrite(db, revoked, { revokedAt: past });
    await rewrite(db, expired, { expiresAt: now });
    expect(await openCredential(world.deps, person('editor'), use(revoked), traceId)).toEqual({
      ok: false,
      reason: 'credential_revoked',
    });
    expect(await openCredential(world.deps, person('editor'), use(expired), traceId)).toEqual({
      ok: false,
      reason: 'credential_expired',
    });
  });
}

function refusingWithoutFacts(): void {
  it('tells someone with no leave nothing about a revoked credential', async () => {
    const id = await created('Revoked and asked about');
    await bind(db, id);
    await rewrite(db, id, { revokedAt: past });
    expect(await openCredential(world.deps, person('viewer'), use(id), traceId)).toEqual({
      ok: false,
      reason: 'not_permitted',
    });
  });

  it('answers credential_not_found for an id that is not a credential, and logs nothing', async () => {
    const before = await counts(db);
    const outcome = await openCredential(
      world.deps,
      person('editor'),
      use(crypto.randomUUID()),
      traceId,
    );
    expect(outcome).toEqual({ ok: false, reason: 'credential_not_found' });
    expect(await counts(db)).toEqual(before);
  });

  it('records a key service failure as the refusal, not as an exception', async () => {
    const id = await created('Key service down');
    await bind(db, id);
    world.keys.failNext('key_service_unavailable');
    expect(await openCredential(world.deps, person('editor'), use(id), traceId)).toEqual({
      ok: false,
      reason: 'key_service_unavailable',
    });
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      outcome: 'refused',
      reason: 'key_service_unavailable',
    });
  });
}

function revealing(): void {
  const reveal = (credentialId: string) => ({ action: 'reveal', credentialId }) as const;

  it('reveals to a viewer who holds a live reveal grant, and records it', async () => {
    const id = await created('Revealed', 'the revealed value');
    await grantReveal(db, id, 'viewer', { expiresAt: soon });
    const opened = await openCredential(world.deps, person('viewer'), reveal(id), traceId);
    expect(opened.ok && textOf(opened.value)).toBe('the revealed value');
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      action: 'reveal',
      outcome: 'done',
      actor: `human:${people.viewer}`,
      harness_id: null,
      run_id: null,
    });
  });

  it.each([
    ['an area admin with no reveal grant', () => person('admin'), null],
    ['an org admin with no reveal grant', () => person('orgAdmin'), null],
    ['a viewer whose reveal grant has expired', () => person('viewer'), { expiresAt: now }],
    [
      'a viewer whose reveal grant was revoked',
      () => person('viewer'),
      { expiresAt: soon, revokedAt: past },
    ],
    ['an agent of a person who holds a reveal grant', () => agentOf('viewer'), { expiresAt: soon }],
  ])('refuses %s, and records the refusal', async (_name, actor, grant) => {
    const id = await created(`Refused reveal ${crypto.randomUUID()}`);
    if (grant !== null) await grantReveal(db, id, 'viewer', grant);
    const outcome = await openCredential(world.deps, actor(), reveal(id), traceId);
    expect(outcome).toEqual({ ok: false, reason: 'not_permitted' });
    expect((await logOf(db, id)).at(-1)).toMatchObject({
      action: 'reveal',
      outcome: 'refused',
      reason: 'not_permitted',
    });
  });

  it('reveals to an org admin once they hold a reveal grant like anyone else', async () => {
    const id = await created('Revealed to an org admin');
    await grantReveal(db, id, 'orgAdmin', { expiresAt: soon });
    expect((await openCredential(world.deps, person('orgAdmin'), reveal(id), traceId)).ok).toBe(
      true,
    );
  });
}

describe.skipIf(!testServer)('#157 the credentials store on Postgres', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase(testServer ?? '');
    db = createClient(database.connectionString);
    for (const seeded of seededPeople) await seedPerson(db, seeded);
    await seedHarness(db, { id: harnessId, key: 'finance', jdArea: '20-29' });
    await seedHarness(db, { id: otherHarnessId, key: 'finance-two', jdArea: '20-29' });
    world = await worldOn(db);
  });

  afterAll(async () => {
    await db.$client.end();
    await database.drop();
  });

  describe('creating a credential needs manage', creating);
  describe('a credential that may not be created writes nothing', refusingCreation);
  describe('a database dump alone decrypts nothing', dumping);
  describe('a credential row moved to another area does not open', movedRows);
  describe('rotating adds a version', rotating);
  describe('a rotation that is refused is recorded', refusingRotation);
  describe('using a credential needs use, where it is bound', using);
  describe('a use that is refused is recorded', refusingUse);
  describe('a refusal gives away no more than it must', refusingWithoutFacts);
  describe('revealing a credential needs a live reveal grant', revealing);
});
