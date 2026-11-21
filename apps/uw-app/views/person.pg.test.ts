import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Role } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPage, seedPerson, seedRevokedDefaultReading } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { accessPath, personPath } from './parts/paths.ts';

const ADMIN = { id: '00000000-0000-4000-8000-0000000002a1', email: 'org.admin@unfoldingword.org' };
const AVERY = {
  id: '00000000-0000-4000-8000-0000000002a2',
  email: 'avery.stone@unfoldingword.org',
};
const BLAIR = { id: '00000000-0000-4000-8000-0000000002a3', email: 'blair.reed@unfoldingword.org' };
const GUEST = { id: '00000000-0000-4000-8000-0000000002a4', email: 'guest@example.org' };
const IDLE = { id: '00000000-0000-4000-8000-0000000002a5', email: 'idle.mate@unfoldingword.org' };
const GONE = { id: '00000000-0000-4000-8000-0000000002a6', email: 'gone.mate@unfoldingword.org' };
const INFRA = {
  id: '00000000-0000-4000-8000-0000000002a7',
  email: 'infra.lead@unfoldingword.org',
};
const TECH_PAGE = '00000000-0000-4000-8000-0000000002b1';
const FINANCE_PAGE = '00000000-0000-4000-8000-0000000002b2';

function grant(id: string, personId: string, area: string | null, role: Role = 'viewer') {
  return {
    id,
    personId,
    role,
    scopeKind: area === null ? ('org' as const) : ('jd_area' as const),
    scopeArea: area,
    grantedAt: new Date('2026-11-01T00:00:00.000Z'),
    expiresAt: null,
  };
}

function ownedPage(id: string, area: string, title: string) {
  return {
    id,
    type: 'knowledge' as const,
    status: 'active' as const,
    jdArea: area,
    title,
    bodyMd: 'A page.',
    slug: `person-${id.slice(-4)}`,
    frontmatter: { owner: `human:${BLAIR.id}` },
  };
}

async function scene(db: Database): Promise<void> {
  for (const person of [ADMIN, AVERY, BLAIR, IDLE, INFRA]) await seedPerson(db, person);
  await seedPerson(db, { ...GONE, status: 'disabled' });
  await seedGrant(db, grant('00000000-0000-4000-8000-0000000002c4', INFRA.id, '30-39', 'admin'));
  await seedRevokedDefaultReading(db, IDLE.id, new Date());
  await seedPerson(db, { ...GUEST, status: 'pending' });
  await seedGrant(db, grant('00000000-0000-4000-8000-0000000002c1', ADMIN.id, null, 'admin'));
  await seedGrant(db, grant('00000000-0000-4000-8000-0000000002c2', AVERY.id, '80-89'));
  await seedGrant(db, grant('00000000-0000-4000-8000-0000000002c3', BLAIR.id, '80-89'));
  await seedPage(db, ownedPage(TECH_PAGE, '80-89', 'How we ship'));
  await seedPage(db, ownedPage(FINANCE_PAGE, '20-29', 'How we close the month'));
}

async function open(db: Database, email: string, path: string) {
  const page = await getHtml(db, email, path);
  return { page, document: new JSDOM(page.text).window.document };
}

async function colleagueReadsThePage(db: Database): Promise<void> {
  await scene(db);
  const { page, document } = await open(db, AVERY.email, personPath(BLAIR.id, BLAIR.email));
  expect(page.status).toBe(200);
  expect(document.querySelector('main h1')?.textContent).toBe(BLAIR.email);
  expect(document.querySelector('main')?.textContent).toContain('Joined');
  const owned = [...document.querySelectorAll('main a[href^="/pages/"]')].map((a) => a.textContent);
  expect(owned).toEqual(['How we ship']);
  expect(await screenProblems(page.text)).toEqual([]);
  const bare = await open(db, AVERY.email, personPath(BLAIR.id));
  expect(bare.page.status).toBe(200);
}

async function unreadablePersonIsNotFound(db: Database): Promise<void> {
  await scene(db);
  expect((await open(db, AVERY.email, personPath(GUEST.id))).page.status).toBe(404);
  expect((await open(db, AVERY.email, personPath(GONE.id))).page.status).toBe(404);
  expect((await open(db, ADMIN.email, personPath(GONE.id))).page.status).toBe(200);
  expect((await open(db, IDLE.email, personPath(BLAIR.id))).page.status).toBe(404);
  expect((await open(db, IDLE.email, personPath(IDLE.id))).page.status).toBe(200);
  expect((await open(db, ADMIN.email, personPath(GUEST.id))).page.status).toBe(200);
  expect((await open(db, AVERY.email, '/people/not-an-id')).page.status).toBe(404);
}

async function agentIsRefused(db: Database): Promise<void> {
  await scene(db);
  const keys = await createAccessFixture();
  const token = await keys.sign({ common_name: 'a1b2c3d4.access' });
  const response = await createApp(postgresDeps(db, keys)).request(
    personPath(BLAIR.id),
    { headers: { 'cf-access-jwt-assertion': token, accept: 'text/html' } },
    fixtureAccessEnv,
  );
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain(BLAIR.email);
}

async function unreadablePersonHasNoLink(db: Database): Promise<void> {
  await scene(db);
  const { document } = await open(db, INFRA.email, accessPath());
  const guest = [...document.querySelectorAll('main [data-person-chip]')].find((chip) =>
    (chip.textContent ?? '').includes(GUEST.email),
  );
  expect(guest?.tagName).toBe('SPAN');
  const infra = [...document.querySelectorAll('main [data-person-chip]')].find((chip) =>
    (chip.textContent ?? '').includes(INFRA.email),
  );
  expect(infra?.tagName).toBe('A');
}

async function accessLinksEveryPerson(db: Database): Promise<void> {
  await scene(db);
  const { document } = await open(db, ADMIN.email, accessPath());
  const chips = [...document.querySelectorAll('main a[data-person-chip]')];
  expect(chips.map((chip) => chip.getAttribute('href'))).toContain(
    personPath(BLAIR.id, BLAIR.email),
  );
  expect(chips.every((chip) => (chip.textContent ?? '').length > 0)).toBe(true);
}

describe.skipIf(!testServer)('#208 the person page', () => {
  it('shows a colleague what the directory holds and the pages they own that the reader may read', () =>
    withAppDatabase(colleagueReadsThePage));
  it('answers not found for a person the reader may not open', () =>
    withAppDatabase(unreadablePersonIsNotFound));
  it('links every person on the Access screen to their page', () =>
    withAppDatabase(accessLinksEveryPerson));
  it('refuses an agent identity asking for a person page', () => withAppDatabase(agentIsRefused));
  it('shows a person the reader may not open as a chip with no link', () =>
    withAppDatabase(unreadablePersonHasNoLink));
});
