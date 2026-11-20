import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
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
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { credentialPath, credentialsPath } from './parts/paths.ts';

const planted = 'uw-planted-credential-value-159-screen';
const missing = '00000000-0000-4000-8000-00000000dead';

type Scene = { readonly app: CredentialsApp; readonly finance: string; readonly tech: string };

async function idOf(db: Database, name: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM credentials WHERE name = ${name}`,
  );
  return [...rows][0]?.id ?? '';
}

async function scene(db: Database): Promise<Scene> {
  await seedCast(db);
  const app = await credentialsApp(db);
  const base = { command: 'create_credential', jdRef: null, kind: 'api_key', expiresAt: null };
  const made = [
    await app.send(cast.admin.email, {
      ...base,
      jdArea: '20-29',
      jdRef: '28',
      name: 'Bank export key',
      ownerId: cast.editor.id,
      rotateBy: '2027-02-01',
      value: planted,
    }),
    await app.send(cast.outsider.email, {
      ...base,
      jdArea: '80-89',
      name: 'Partner portal password',
      kind: 'password',
      ownerId: cast.outsider.id,
      rotateBy: null,
      value: planted,
    }),
  ];
  expect(made.map((answer) => answer.body['status'])).toEqual(['accepted', 'accepted']);
  return {
    app,
    finance: await idOf(db, 'Bank export key'),
    tech: await idOf(db, 'Partner portal password'),
  };
}

async function page(app: CredentialsApp, email: string, path: string) {
  const answer = await app.get(email, path);
  return { ...answer, document: new JSDOM(answer.text).window.document };
}

function names(document: Document): string[] {
  return [...document.querySelectorAll('main table tbody tr td:first-child a')].map(
    (cell) => cell.textContent ?? '',
  );
}

function commands(document: Document): string[] {
  const forms = [...document.querySelectorAll('main form[data-command]')];
  return [...new Set(forms.map((form) => form.getAttribute('data-command') ?? ''))].sort();
}

function cards(document: Document): string[] {
  return [...document.querySelectorAll('main section h2')].map((title) => title.textContent ?? '');
}

function choices(document: Document, form: string, field: string): string[] {
  const select = document.querySelector(`form[data-command="${form}"] select[name="${field}"]`);
  return [...(select?.querySelectorAll('option') ?? [])].map((option) => option.textContent ?? '');
}

async function areaAdmin(db: Database): Promise<void> {
  const { app, finance, tech } = await scene(db);
  const list = await page(app, cast.admin.email, credentialsPath());
  expect(list.status).toBe(200);
  expect(names(list.document)).toEqual(['Bank export key']);
  expect(list.text).not.toContain('Partner portal password');
  expect(commands(list.document)).toEqual(['create_credential']);
  expect(choices(list.document, 'create_credential', 'jdArea')).toEqual(['20-29 Finance']);
  expect(list.document.querySelector('nav a[href="/credentials"]')?.textContent).toContain(
    'Credentials',
  );
  expect(list.headers.get('cache-control')).toBe('no-store');
  expect(await screenProblems(list.text)).toEqual([]);
  const detail = await page(app, cast.admin.email, credentialPath(finance));
  expect(detail.status).toBe(200);
  expect(cards(detail.document)).toEqual([
    'About',
    'Value',
    'Where it can be used',
    'Reveal grants',
    'Rotate',
    'Revoke',
    'Access log',
  ]);
  expect(commands(detail.document)).toEqual([
    'bind_credential',
    'grant_reveal',
    'revoke_credential',
    'rotate_credential',
  ]);
  expect(detail.document.querySelector('form[data-reveal]')).toBeNull();
  expect(detail.text).toContain('You hold no reveal grant for this credential.');
  expect(detail.text).toContain('Give a reveal grant');
  expect(choices(detail.document, 'grant_reveal', 'personId')).toEqual([
    ROWAN,
    cast.admin.email,
    cast.editor.email,
    cast.viewer.email,
    cast.second.email,
  ]);
  expect(choices(detail.document, 'bind_credential', 'harnessId')).toEqual(['monthly-close']);
  expect(detail.text).not.toContain(planted);
  expect(await screenProblems(detail.text)).toEqual([]);
  expect((await page(app, cast.admin.email, credentialPath(tech))).status).toBe(404);
}

async function viewerAndEditor(db: Database): Promise<void> {
  const { app, finance } = await scene(db);
  for (const who of [cast.viewer, cast.editor]) {
    const list = await page(app, who.email, credentialsPath());
    expect(names(list.document)).toEqual(['Bank export key']);
    expect(commands(list.document)).toEqual([]);
    expect(list.text).toContain('You see that each one exists, never its value.');
    const detail = await page(app, who.email, credentialPath(finance));
    expect(cards(detail.document)).toEqual(['About', 'Value']);
    expect(commands(detail.document)).toEqual([]);
    expect(detail.document.querySelector('form[data-reveal]')).toBeNull();
    expect(detail.text).toContain(cast.editor.email);
    expect(detail.text).not.toContain('Access log');
    expect(await screenProblems(detail.text)).toEqual([]);
  }
  await app.send(cast.admin.email, {
    command: 'grant_reveal',
    credentialId: finance,
    personId: cast.viewer.id,
    minutes: 15,
  });
  const granted = await page(app, cast.viewer.email, credentialPath(finance));
  const reveal = granted.document.querySelector('form[data-reveal]');
  expect(reveal?.getAttribute('data-reveal')).toBe(finance);
  expect(reveal?.querySelector('[data-revealed]')?.textContent).toBe('');
  expect(reveal?.querySelector('[data-revealed]')?.hasAttribute('hidden')).toBe(true);
  expect(granted.text).toContain('Each reveal is recorded and tells the admins of this area.');
  expect(await screenProblems(granted.text)).toEqual([]);
  const list = await page(app, cast.viewer.email, credentialsPath());
  expect(list.text).toContain('you can reveal it');
  const other = await page(app, cast.editor.email, credentialPath(finance));
  expect(other.document.querySelector('form[data-reveal]')).toBeNull();
}

async function orgAdmin(db: Database): Promise<void> {
  const { app, finance } = await scene(db);
  const list = await page(app, ROWAN, credentialsPath());
  expect(names(list.document)).toEqual(['Bank export key', 'Partner portal password']);
  expect(choices(list.document, 'create_credential', 'jdArea')).toHaveLength(10);
  const detail = await page(app, ROWAN, credentialPath(finance));
  expect(detail.text).toContain('Ask for a reveal grant');
  expect(detail.text).toContain('waits until a second org admin confirms it');
  expect(detail.document.querySelector('form[data-reveal]')).toBeNull();
  await app.send(ROWAN, {
    command: 'grant_reveal',
    credentialId: finance,
    personId: cast.second.id,
    minutes: 60,
  });
  const asked = await page(app, ROWAN, credentialPath(finance));
  expect(asked.text).toContain('Waiting for a second org admin');
  expect(commands(asked.document)).not.toContain('confirm_reveal');
  expect(commands(asked.document)).toContain('revoke_reveal');
  const second = await page(app, cast.second.email, credentialPath(finance));
  expect(commands(second.document)).toContain('confirm_reveal');
  expect(second.document.querySelector('form[data-reveal]')).toBeNull();
  expect(await screenProblems(second.text)).toEqual([]);
  const areaAdminView = await page(app, cast.admin.email, credentialPath(finance));
  expect(commands(areaAdminView.document)).toContain('confirm_reveal');
}

async function nothingForTheRest(db: Database): Promise<void> {
  const { app, finance } = await scene(db);
  const absent = await page(app, cast.admin.email, credentialPath(missing));
  expect(absent.status).toBe(404);
  for (const who of [cast.orgViewer, cast.orgEditor, cast.nobody]) {
    const list = await page(app, who.email, credentialsPath());
    expect(list.status).toBe(200);
    expect(names(list.document)).toEqual([]);
    expect(commands(list.document)).toEqual([]);
    expect(list.text).toContain('No credentials to show.');
    expect(list.text).not.toContain('Bank export key');
    expect(await screenProblems(list.text)).toEqual([]);
    const detail = await page(app, who.email, credentialPath(finance));
    expect(detail.status).toBe(404);
    expect(detail.document.querySelector('main')?.textContent).toBe(
      absent.document.querySelector('main')?.textContent,
    );
    expect(detail.text).not.toContain('Bank export key');
  }
  const outsider = await page(app, cast.outsider.email, credentialsPath());
  expect(names(outsider.document)).toEqual(['Partner portal password']);
  expect((await page(app, cast.outsider.email, credentialPath(finance))).status).toBe(404);
  expect((await page(app, cast.outsider.email, '/credentials/not-an-id')).status).toBe(404);
}

async function logAndRevoked(db: Database): Promise<void> {
  const { app, finance } = await scene(db);
  const binding = { credentialId: finance, harnessId: workflowId, connectorKey: 'send' };
  await app.send(cast.admin.email, { command: 'bind_credential', ...binding });
  await app.send(cast.editor.email, { command: 'revoke_credential', credentialId: finance });
  await app.reveal(cast.admin.email, finance);
  const live = await page(app, cast.admin.email, credentialPath(finance));
  const log = [...live.document.querySelectorAll('main table')]
    .find((table) => table.querySelector('caption')?.textContent === 'Access log')
    ?.querySelectorAll('tbody tr');
  const lines = [...(log ?? [])].map((row) =>
    [...row.querySelectorAll('td')]
      .slice(1)
      .map((cell) => cell.textContent ?? '')
      .join(' | '),
  );
  expect(lines).toEqual([
    `${cast.admin.email} | Revealed | Refused: not permitted | `,
    `${cast.editor.email} | Revoked | Refused: not permitted | `,
    `${cast.admin.email} | Bound | Done | monthly-close · Send`,
    `${cast.admin.email} | Added | Done | `,
  ]);
  expect(commands(live.document)).toContain('unbind_credential');
  await app.send(cast.admin.email, { command: 'revoke_credential', credentialId: finance });
  const revoked = await page(app, cast.admin.email, credentialPath(finance));
  expect(cards(revoked.document)).toEqual([
    'About',
    'Value',
    'Where it can be used',
    'Reveal grants',
    'Access log',
  ]);
  expect(commands(revoked.document)).toEqual(['unbind_credential']);
  expect(revoked.text).toContain('This credential is revoked. Nobody can reveal its value.');
  expect(await screenProblems(revoked.text)).toEqual([]);
  const list = await page(app, cast.viewer.email, credentialsPath());
  expect(list.text).toContain('Revoked');
}

describe.skipIf(!testServer)('#159 the Credentials screens', () => {
  it('an area admin sees and manages the credentials of their own area and no other', () =>
    withAppDatabase(areaAdmin));
  it('a viewer or editor sees that a credential exists, and a reveal control only with a grant', () =>
    withAppDatabase(viewerAndEditor));
  it('an org admin sees every area, and a reveal grant they give waits for a second org admin', () =>
    withAppDatabase(orgAdmin));
  it('an org viewer, an org editor and a person with no grant see nothing, and cannot tell a credential exists', () =>
    withAppDatabase(nothingForTheRest));
  it('the access log speaks in words, and a revoked credential keeps only its record and unbind', () =>
    withAppDatabase(logAndRevoked));
});
