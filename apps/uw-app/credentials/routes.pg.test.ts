import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import {
  ROWAN,
  cast,
  credentialsApp,
  seedCast,
  workflowId,
  type CredentialsApp,
} from '../testing/credentials-app.ts';
import { dumpEveryTable } from '../testing/credentials-world.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { toBase64, utf8 } from './base64.ts';

const planted = 'uw-planted-credential-value-159-routes';
const missing = '00000000-0000-4000-8000-00000000dead';

function newCredential(name: string, value = planted) {
  return {
    command: 'create_credential',
    jdArea: '20-29',
    jdRef: null,
    name,
    kind: 'api_key',
    ownerId: cast.admin.id,
    rotateBy: '2027-02-01',
    expiresAt: null,
    value,
  };
}

async function idOf(db: Database, name: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM credentials WHERE name = ${name}`,
  );
  const [row] = [...rows];
  if (row === undefined) throw new Error(`no credential named ${name}`);
  return row.id;
}

async function grantIdOf(db: Database, credentialId: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM credential_grants WHERE credential_id = ${credentialId}
        ORDER BY granted_at DESC LIMIT 1`,
  );
  return [...rows][0]?.id ?? '';
}

async function made(db: Database, app: CredentialsApp, name: string): Promise<string> {
  const created = await app.send(cast.admin.email, newCredential(name));
  expect(created.body).toMatchObject({ status: 'accepted' });
  return idOf(db, name);
}

async function lifeOfACredential(db: Database): Promise<void> {
  await seedCast(db);
  const app = await credentialsApp(db);
  const id = await made(db, app, 'Bank export key');
  const binding = { credentialId: id, harnessId: workflowId, connectorKey: 'send' };
  const steps = [
    await app.send(cast.admin.email, { command: 'bind_credential', ...binding }),
    await app.send(cast.admin.email, { command: 'unbind_credential', ...binding }),
    await app.send(cast.admin.email, {
      command: 'rotate_credential',
      credentialId: id,
      rotateBy: null,
      expiresAt: null,
      value: `${planted}-rotated`,
    }),
    await app.send(cast.admin.email, {
      command: 'grant_reveal',
      credentialId: id,
      personId: cast.viewer.id,
      minutes: 15,
    }),
  ];
  expect(steps.map((step) => step.body['status'])).toEqual(steps.map(() => 'accepted'));
  const revealed = await app.reveal(cast.viewer.email, id);
  expect(revealed.body).toMatchObject({ status: 'accepted', value: `${planted}-rotated` });
  const grantId = await grantIdOf(db, id);
  const taken = await app.send(cast.admin.email, { command: 'revoke_reveal', grantId });
  expect(taken.body['status']).toBe('accepted');
  expect((await app.reveal(cast.viewer.email, id)).body['reason']).toBe('not_permitted');
  const revoked = await app.send(cast.admin.email, {
    command: 'revoke_credential',
    credentialId: id,
  });
  expect(revoked.body['status']).toBe('accepted');
  const again = await app.send(cast.admin.email, { command: 'bind_credential', ...binding });
  expect(again).toMatchObject({ status: 422, body: { reason: 'credential_revoked' } });
}

type Case = readonly [string, Record<string, unknown> & { command: string }, string];

function creatingCases(): readonly Case[] {
  return [
    [cast.editor.email, newCredential('By an editor'), 'not_permitted'],
    [cast.outsider.email, newCredential('By another area'), 'not_permitted'],
    [cast.orgEditor.email, newCredential('By an org editor'), 'not_permitted'],
    [cast.admin.email, { ...newCredential('Elsewhere'), jdArea: '80-89' }, 'not_permitted'],
    [cast.admin.email, { ...newCredential('Bad ref'), jdRef: '31' }, 'malformed_command'],
    [cast.admin.email, { ...newCredential('No owner'), ownerId: missing }, 'person_not_found'],
    [cast.admin.email, { ...newCredential('Bad id'), ownerId: 'nobody' }, 'malformed_command'],
  ];
}

function changingCases(id: string): readonly Case[] {
  return [
    [cast.editor.email, { command: 'revoke_credential', credentialId: id }, 'not_permitted'],
    [
      cast.outsider.email,
      { command: 'revoke_credential', credentialId: id },
      'credential_not_found',
    ],
    [
      cast.orgViewer.email,
      { command: 'revoke_credential', credentialId: id },
      'credential_not_found',
    ],
    [
      cast.admin.email,
      { command: 'revoke_credential', credentialId: missing },
      'credential_not_found',
    ],
    [
      cast.admin.email,
      { command: 'revoke_credential', credentialId: 'not-an-id' },
      'malformed_command',
    ],
    [
      cast.admin.email,
      {
        command: 'bind_credential',
        credentialId: id,
        harnessId: missing,
        connectorKey: 'send',
      },
      'harness_not_found',
    ],
    [
      cast.admin.email,
      {
        command: 'grant_reveal',
        credentialId: id,
        personId: cast.viewer.id,
        minutes: 100_000,
      },
      'malformed_command',
    ],
    [cast.admin.email, { command: 'confirm_reveal', grantId: missing }, 'grant_not_found'],
    [cast.admin.email, { command: 'read_credential', credentialId: id }, 'not_wired'],
    [cast.admin.email, { command: 'reveal_credential', credentialId: id }, 'not_wired'],
  ];
}

async function refusalsByReason(db: Database): Promise<void> {
  await seedCast(db);
  const app = await credentialsApp(db);
  const id = await made(db, app, 'Refusals');
  const twice = await app.send(cast.admin.email, newCredential('Refusals'));
  expect(twice.body['reason']).toBe('credential_name_taken');
  const cases = [...creatingCases(), ...changingCases(id)];
  for (const [email, body, reason] of cases) {
    const answer = await app.send(email, body);
    expect(`${body.command} by ${email}: ${String(answer.body['reason'])}`).toBe(
      `${body.command} by ${email}: ${reason}`,
    );
    expect(answer.text).not.toMatch(/drizzle|postgres|syntax|constraint|violat|stack/i);
  }
  expect((await app.reveal(cast.outsider.email, id)).body['reason']).toBe('credential_not_found');
  expect((await app.reveal(cast.admin.email, missing)).body['reason']).toBe('credential_not_found');
  expect((await app.reveal(cast.admin.email, id)).body['reason']).toBe('not_permitted');
}

async function twoOrgAdmins(db: Database): Promise<void> {
  await seedCast(db);
  const app = await credentialsApp(db);
  const id = await made(db, app, 'Break glass');
  const ask = { command: 'grant_reveal', credentialId: id, personId: cast.second.id, minutes: 30 };
  expect((await app.send(cast.second.email, ask)).body['status']).toBe('accepted');
  const grantId = await grantIdOf(db, id);
  expect((await app.reveal(cast.second.email, id)).body['reason']).toBe('not_permitted');
  const alone = await app.send(cast.second.email, { command: 'confirm_reveal', grantId });
  expect(alone.body['reason']).toBe('second_admin_required');
  const byEditor = await app.send(cast.orgEditor.email, { command: 'confirm_reveal', grantId });
  expect(byEditor.body['reason']).toBe('grant_not_found');
  expect((await app.send(ROWAN, { command: 'confirm_reveal', grantId })).body['status']).toBe(
    'accepted',
  );
  expect((await app.reveal(cast.second.email, id)).body).toMatchObject({ value: planted });
  const rows = await db.execute<{ granted_by: string; second_by: string }>(
    sql`SELECT granted_by, second_by FROM credential_grants WHERE id = ${grantId}`,
  );
  const [row] = [...rows];
  expect(row?.granted_by).toBe(cast.second.id);
  expect(row?.second_by).not.toBe(cast.second.id);
  expect(row?.second_by).not.toBeNull();
}

function formsOf(value: string): string[] {
  const encoded = toBase64(utf8(value)).replaceAll('=', '');
  return [value, encoded, encodeURIComponent(value)];
}

async function revealStaysInOneAnswer(db: Database): Promise<void> {
  await seedCast(db);
  const app = await credentialsApp(db);
  const id = await made(db, app, 'Portal password');
  await app.send(cast.admin.email, {
    command: 'grant_reveal',
    credentialId: id,
    personId: cast.viewer.id,
    minutes: 15,
  });
  const revealed = await app.reveal(cast.viewer.email, id);
  expect(revealed.status).toBe(200);
  expect(revealed.body).toEqual({
    status: 'accepted',
    requestId: revealed.body['requestId'],
    value: planted,
  });
  expect(revealed.headers.get('cache-control')).toBe('no-store');
  expect(revealed.headers.get('pragma')).toBe('no-cache');
  expect(revealed.headers.get('content-type')).toContain('application/json');
  const refused = await app.reveal(cast.editor.email, id);
  expect(refused.headers.get('cache-control')).toBe('no-store');
  const elsewhere = [
    ...app.lines.map((line) => ['a log line', line] as const),
    ['every table', await dumpEveryTable(db)] as const,
    ['the list', (await app.get(cast.viewer.email, '/credentials')).text] as const,
    ['the page', (await app.get(cast.viewer.email, `/credentials/${id}`)).text] as const,
    ['the admin’s page', (await app.get(cast.admin.email, `/credentials/${id}`)).text] as const,
    ['a refusal', refused.text] as const,
    ...[...revealed.headers.entries()].map(([name, text]) => [`header ${name}`, text] as const),
  ];
  expect(app.lines.length).toBeGreaterThan(5);
  expect(app.lines.some((line) => line.includes('/api/credentials/reveal'))).toBe(true);
  const leaks = elsewhere
    .filter(([, text]) => formsOf(planted).some((form) => text.includes(form)))
    .map(([where]) => where);
  expect(leaks).toEqual([]);
  const log = await db.execute<{ action: string; outcome: string; person_id: string }>(
    sql`SELECT action, outcome, person_id FROM credential_access_log
        WHERE credential_id = ${id} AND action = 'reveal' ORDER BY position`,
  );
  expect([...log]).toEqual([
    { action: 'reveal', outcome: 'done', person_id: cast.viewer.id },
    { action: 'reveal', outcome: 'refused', person_id: cast.editor.id },
  ]);
}

async function noKeyService(db: Database): Promise<void> {
  await seedCast(db);
  const app = await credentialsApp(db, { keyService: false });
  const created = await app.send(cast.admin.email, newCredential('No key service'));
  expect(created).toMatchObject({ status: 422, body: { reason: 'key_service_not_configured' } });
  const rows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM credentials`);
  expect([...rows][0]?.n).toBe(0);
}

async function notAPersonAtTheKeyboard(db: Database): Promise<void> {
  await seedCast(db);
  const app = await credentialsApp(db);
  const id = await made(db, app, 'Kept from agents');
  const body = { command: 'reveal_credential', requestId: randomUUID(), credentialId: id };
  const service = await app.fixture.sign({ common_name: 'a1b2c3d4.access' });
  const forMcp = await app.fixture.signForMcp({ common_name: 'a1b2c3d4.access' });
  for (const token of [service, forMcp, 'not-a-token']) {
    const reveal = await app.post(token, '/api/credentials/reveal', body);
    expect(reveal.status).toBe(401);
    const revoke = await app.post(token, '/api/credentials/commands/revoke_credential', {
      ...body,
      command: 'revoke_credential',
    });
    expect(revoke.status).toBe(401);
    expect(`${reveal.text}${revoke.text}`).not.toContain(planted);
  }
  const person = await app.fixture.sign({ email: cast.admin.email });
  const notACommand = await app.post(person, '/api/credentials/reveal', 'reveal it');
  expect(notACommand).toMatchObject({ status: 400, body: { reason: 'malformed_command' } });
}

describe.skipIf(!testServer)('#159 the credential commands', () => {
  it('create, bind, unbind, rotate, grant, reveal, take the grant back, and revoke', () =>
    withAppDatabase(lifeOfACredential));
  it('answers every refusal with a closed-set reason and never the database’s words', () =>
    withAppDatabase(refusalsByReason));
  it('holds an org admin’s reveal until a second org admin confirms it', () =>
    withAppDatabase(twoOrgAdmins));
  it('delivers a revealed value in one uncached answer and nowhere else', () =>
    withAppDatabase(revealStaysInOneAnswer));
  it('answers key_service_not_configured and stores nothing when there is no key service', () =>
    withAppDatabase(noKeyService));
  it('refuses a service token, an MCP token and a bad token before any command runs', () =>
    withAppDatabase(notAPersonAtTheKeyboard));
});
