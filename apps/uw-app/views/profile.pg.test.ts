import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Principal, SetPropertyCommand } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage, seedPerson, seedRevokedDefaultReading } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import { ensureBuiltIns } from '../collections/builtins/seed.ts';
import { setProperty } from '../collections/rows.ts';
import { saveProfileBody } from '../people/profile-body.ts';
import { readPage, updatePage } from '../pages/store.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { collectionsAt, personWith, requestOf, rowIn } from '../testing/collections.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { accessPath, personPath } from './parts/paths.ts';

type World = {
  readonly db: Database;
  readonly admin: Principal;
  readonly steward: Principal;
  readonly avery: Principal;
  readonly blair: Principal;
  readonly idle: Principal;
  readonly pending: string;
  readonly gone: string;
};

const reading = { role: 'viewer', area: '00-09' } as const;

async function world(db: Database): Promise<World> {
  await ensureBuiltIns(db, collectionsAt);
  const admin = await personWith(db, 'org.admin', [{ role: 'admin', area: null }]);
  const steward = await personWith(db, 'people.lead', [reading, { role: 'admin', area: '10-19' }]);
  const avery = await personWith(db, 'avery.stone', [reading, { role: 'editor', area: '80-89' }]);
  const blair = await personWith(db, 'blair.reed', [reading, { role: 'editor', area: '80-89' }]);
  const idle = await personWith(db, 'idle.mate', [{ role: 'viewer', area: '80-89' }]);
  await seedRevokedDefaultReading(db, idOf(idle), new Date());
  const pending = randomUUID();
  const gone = randomUUID();
  await seedPerson(db, { id: pending, email: 'guest@example.org', status: 'pending' });
  await seedPerson(db, { id: gone, email: 'gone.mate@unfoldingword.org', status: 'disabled' });
  return { db, admin, steward, avery, blair, idle, pending, gone };
}

function idOf(person: Principal): string {
  return person.personId ?? '';
}

async function open(w: World, reader: Principal, path: string) {
  const page = await getHtml(w.db, reader.email ?? '', path);
  return { page, document: new JSDOM(page.text).window.document };
}

function set(personId: string, property: string, value: SetPropertyCommand['value']) {
  return {
    command: 'set_property',
    requestId: randomUUID(),
    collection: 'directory',
    rowId: personId,
    property,
    value,
  } as const;
}

function saveBody(personId: string, bodyMd: string, expectedVersion: number | null) {
  return {
    command: 'save_profile_body',
    requestId: randomUUID(),
    personId,
    expectedVersion,
    bodyMd,
  } as const;
}

function save(w: World, actor: Principal, command: ReturnType<typeof saveBody>) {
  return saveProfileBody(w.db, actor, command, randomUUID(), collectionsAt);
}

function cardText(document: Document, title: string): string {
  const card = [...document.querySelectorAll('main section, main article, main div')].find(
    (node) => node.querySelector('h2, h3')?.textContent === title,
  );
  return card?.textContent ?? '';
}

async function colleagueOpensTheProfile(w: World): Promise<void> {
  const { page, document } = await open(w, w.avery, personPath(idOf(w.blair)));
  expect(page.status).toBe(200);
  expect(document.querySelector('main h1')?.textContent).toBe(w.blair.email);
  expect(document.querySelector('main')?.textContent).toContain('About');
  expect(document.querySelector('form[data-command="save_profile_body"]')).toBeNull();
  expect(await screenProblems(page.text)).toEqual([]);
  expect((await open(w, w.avery, `/people/${idOf(w.blair)}`)).page.status).toBe(404);
}

async function unreadableProfileIsNotFound(w: World): Promise<void> {
  const statuses = [
    (await open(w, w.avery, personPath(w.pending))).page.status,
    (await open(w, w.admin, personPath(w.gone))).page.status,
    (await open(w, w.idle, personPath(idOf(w.blair)))).page.status,
    (await open(w, w.idle, personPath(idOf(w.idle)))).page.status,
  ];
  expect(statuses).toEqual([404, 404, 404, 404]);
  expect((await open(w, w.avery, personPath(w.pending))).page.status).toBe(404);
  expect((await open(w, w.admin, personPath(w.gone))).page.status).toBe(404);
  expect((await open(w, w.idle, personPath(idOf(w.blair)))).page.status).toBe(404);
  expect((await open(w, w.idle, personPath(idOf(w.idle)))).page.status).toBe(404);
  expect((await open(w, w.avery, personPath('not-an-id'))).page.status).toBe(404);
}

async function agentIsRefused(w: World): Promise<void> {
  const keys = await createAccessFixture();
  const token = await keys.sign({ common_name: 'a1b2c3d4.access' });
  const response = await createApp(postgresDeps(w.db, keys)).request(
    personPath(idOf(w.blair)),
    { headers: { 'cf-access-jwt-assertion': token, accept: 'text/html' } },
    fixtureAccessEnv,
  );
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain(w.blair.email ?? '');
}

async function chipsLinkToTheProfile(w: World): Promise<void> {
  const { document } = await open(w, w.admin, accessPath());
  const chips = [...document.querySelectorAll('main [data-person-chip]')];
  const linkOf = (text: string) => chips.find((chip) => (chip.textContent ?? '').includes(text));
  expect(linkOf((w.blair.email ?? '').split('@')[0] ?? '')?.getAttribute('href')).toBe(
    personPath(idOf(w.blair)),
  );
  expect(linkOf('guest')?.tagName).toBe('SPAN');
}

async function privateFieldsFollowTheirRule(w: World): Promise<void> {
  const blair = idOf(w.blair);
  const done = await setProperty(w.db, set(blair, 'phone', '+1 555 0100'), requestOf(w.blair));
  expect(done.status).toBe('accepted');
  const colleague = await open(w, w.avery, personPath(blair));
  expect(colleague.document.querySelector('main')?.textContent).not.toContain('+1 555 0100');
  const self = await open(w, w.blair, personPath(blair));
  expect(self.document.querySelector('main')?.textContent).toContain('+1 555 0100');
  const steward = await open(w, w.steward, personPath(blair));
  expect(steward.document.querySelector('main')?.textContent).toContain('+1 555 0100');
}

async function editingRules(w: World): Promise<void> {
  const blair = idOf(w.blair);
  const own = await setProperty(w.db, set(blair, 'url', 'https://example.org'), requestOf(w.blair));
  expect(own.status).toBe('accepted');
  const role = await setProperty(w.db, set(blair, 'role', 'Director'), requestOf(w.blair));
  expect(role).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const other = await setProperty(w.db, set(blair, 'url', 'https://x.org'), requestOf(w.avery));
  expect(other).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const steward = await setProperty(w.db, set(blair, 'role', 'Director'), requestOf(w.steward));
  expect(steward.status).toBe('accepted');
}

async function bodyIsWrittenByThePersonOrTheSteward(w: World): Promise<void> {
  const blair = idOf(w.blair);
  expect(await save(w, w.avery, saveBody(blair, 'Not mine to write.', null))).toEqual({
    ok: false,
    reason: 'not_permitted',
  });
  expect(await save(w, w.blair, saveBody(blair, 'I look after **tools**.', null))).toEqual({
    ok: true,
  });
  expect(await save(w, w.blair, saveBody(blair, 'Second first write.', null))).toEqual({
    ok: false,
    reason: 'stale_version',
  });
  expect(await save(w, w.steward, saveBody(blair, 'I look after tools and docs.', 1))).toEqual({
    ok: true,
  });
  const { document } = await open(w, w.avery, personPath(blair));
  expect(document.querySelector('[data-page-body]')?.textContent).toContain('tools and docs');
  const self = await open(w, w.blair, personPath(blair));
  expect(self.document.querySelector('form[data-command="save_profile_body"]')).not.toBeNull();
}

async function profilePageOf(w: World, personId: string) {
  const { document } = await open(w, w.blair, personPath(personId));
  const comments = document.querySelector('a[href$="/comments"]')?.getAttribute('href');
  const page = await readPage(w.db, w.admin, comments?.split('/')[2] ?? '', collectionsAt);
  if (page === null) throw new Error('the profile body page must exist');
  return page;
}

async function profilePageRefusesTheGenericEditor(w: World): Promise<void> {
  const blair = idOf(w.blair);
  expect((await save(w, w.blair, saveBody(blair, 'Mine.', null))).ok).toBe(true);
  const page = await profilePageOf(w, blair);
  expect(page.type).toBe('profile');
  const command = {
    command: 'update_page' as const,
    requestId: randomUUID(),
    pageId: page.id,
    expectedVersion: page.version,
    title: page.title,
    slug: page.slug,
    frontmatter: {},
    bodyMd: 'An admin rewrote this.',
    parentId: null,
    status: 'active' as const,
  };
  const result = await updatePage(w.db, w.admin, command, randomUUID(), collectionsAt);
  expect(result).toMatchObject({ ok: false, reason: 'collection_row' });
}

async function listsStayInsideTheReadersGrants(w: World): Promise<void> {
  const blair = idOf(w.blair);
  const assigned = { assignees: [blair], status: 'open' };
  const task = { collection: 'tasks', title: 'Ship the tools release', values: assigned };
  await rowIn(w.db, w.blair, { ...task, jdArea: '80-89' });
  await rowIn(w.db, w.admin, { ...task, jdArea: '20-29', title: 'Close the month' });
  const finished = { ...task, title: 'Old release', values: { ...assigned, status: 'done' } };
  await rowIn(w.db, w.blair, { ...finished, jdArea: '80-89' });
  const program = { collection: 'program', jdArea: '80-89', title: 'Tools' };
  await rowIn(w.db, w.blair, { ...program, values: { team: [blair] } });
  await seedPage(w.db, {
    id: randomUUID(),
    type: 'knowledge',
    status: 'active',
    jdArea: '20-29',
    title: 'How we close the month',
    bodyMd: 'A page.',
    slug: 'close-the-month',
    frontmatter: { owner: `human:${blair}` },
  });
  const { document } = await open(w, w.avery, personPath(blair));
  const tasks = cardText(document, 'Open tasks');
  expect(tasks).toContain('Ship the tools release');
  expect(tasks).not.toContain('Close the month');
  expect(tasks).not.toContain('Old release');
  expect(cardText(document, 'Programs and projects')).toContain('Tools');
  expect(cardText(document, 'Pages they own')).not.toContain('How we close the month');
  const admin = await open(w, w.admin, personPath(blair));
  expect(cardText(admin.document, 'Open tasks')).toContain('Close the month');
  expect(cardText(admin.document, 'Pages they own')).toContain('How we close the month');
}

function run(work: (w: World) => Promise<void>) {
  return withAppDatabase(async (db) => work(await world(db)));
}

describe.skipIf(!testServer)('#208 a person’s profile is their directory row', () => {
  it('opens a colleague’s profile at their directory row, the only person page', () =>
    run(colleagueOpensTheProfile));
  it('answers not found where the directory would not list the person to the reader', () =>
    run(unreadableProfileIsNotFound));
  it('refuses an agent identity asking for a profile', () => run(agentIsRefused));
  it('links a readable person’s chip to the profile and leaves a pending person unlinked', () =>
    run(chipsLinkToTheProfile));
  it('shows a private field to the person and the directory steward, not to a colleague', () =>
    run(privateFieldsFollowTheirRule));
  it('lets a person edit their own contact fields but not their role, and no one else’s', () =>
    run(editingRules));
  it('lets the person or the directory steward write the body, and no colleague', () =>
    run(bodyIsWrittenByThePersonOrTheSteward));
  it('refuses the generic page editor on a profile body, even for an org admin', () =>
    run(profilePageRefusesTheGenericEditor));
  it('lists open tasks, programs and owned pages only from areas the reader can read', () =>
    run(listsStayInsideTheReadersGrants));
});
