import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import {
  createAccessFixture,
  fixtureAccessEnv,
  type AccessFixture,
} from '../testing/access-keys.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';
import { accessPath } from './parts/paths.ts';

const ROWAN = 'rowan.test@unfoldingword.org';
const INFRA = {
  id: '00000000-0000-4000-8000-0000000000d1',
  email: 'infra.admin@unfoldingword.org',
};
const TECH = { id: '00000000-0000-4000-8000-0000000000d2', email: 'tech.editor@unfoldingword.org' };
const FRESH = { id: '00000000-0000-4000-8000-0000000000d3', email: 'new.mate@unfoldingword.org' };
const PARTNER = { id: '00000000-0000-4000-8000-0000000000d4', email: 'partner@example.org' };
const TECH_GRANT = '00000000-0000-4000-8000-0000000000e2';
const INFRA_VIEW_GRANT = '00000000-0000-4000-8000-0000000000e3';

let fixture: AccessFixture;

beforeAll(async () => {
  fixture = await createAccessFixture();
});

function areaGrant(
  id: string,
  personId: string,
  role: 'admin' | 'editor' | 'viewer',
  area: string,
) {
  return {
    id,
    personId,
    role,
    scopeKind: 'jd_area' as const,
    scopeArea: area,
    grantedAt: new Date('2026-11-01T00:00:00.000Z'),
    expiresAt: null,
  };
}

async function scene(db: Database): Promise<void> {
  for (const person of [INFRA, TECH, FRESH]) await seedPerson(db, person);
  await seedPerson(db, { ...PARTNER, status: 'pending' });
  await seedGrant(
    db,
    areaGrant('00000000-0000-4000-8000-0000000000e1', INFRA.id, 'admin', '30-39'),
  );
  await seedGrant(db, areaGrant(TECH_GRANT, TECH.id, 'editor', '80-89'));
  await seedGrant(db, areaGrant(INFRA_VIEW_GRANT, TECH.id, 'viewer', '30-39'));
}

async function documentFor(db: Database, email: string, path = accessPath()) {
  const page = await getHtml(db, email, path);
  expect(page.status).toBe(200);
  return { document: new JSDOM(page.text).window.document, text: page.text };
}

function rowsOf(document: Document, caption: string): string[] {
  const table = [...document.querySelectorAll('main table')].find(
    (found) => found.querySelector('caption')?.textContent === caption,
  );
  return [...(table?.querySelectorAll('tbody tr') ?? [])].map((row) =>
    [...row.querySelectorAll('td')]
      .slice(0, 3)
      .map((cell) => cell.textContent ?? '')
      .join(' | '),
  );
}

function scopeChoices(document: Document): string[] {
  const select = document.querySelector('form[data-command="grant_role"] select[name="scope"]');
  return [...(select?.querySelectorAll('option') ?? [])].map((option) => option.textContent ?? '');
}

async function send(
  db: Database,
  email: string,
  body: { command: string } & Record<string, unknown>,
) {
  const token = await fixture.sign({ email });
  const raw = await createApp(postgresDeps(db, fixture)).request(
    `/api/acl/commands/${body.command}`,
    {
      method: 'POST',
      headers: { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), ...body }),
    },
    fixtureAccessEnv,
  );
  return (await raw.json()) as Record<string, unknown>;
}

async function orgAdminSeesEverything(db: Database): Promise<void> {
  await scene(db);
  const { document, text } = await documentFor(db, ROWAN);
  const grants = rowsOf(document, 'Who has access');
  expect(grants).toContain(`infra.admin${INFRA.email} | admin | 30-39 Infrastructure`);
  expect(grants).toContain(`tech.editor${TECH.email} | editor | 80-89 Tech & SLR`);
  expect(grants.some((row) => row.includes('admin | Whole organization'))).toBe(true);
  expect(rowsOf(document, 'Waiting for access').map((row) => row.split(' | ')[1])).toEqual([
    'No access yet',
    'Waiting for approval',
  ]);
  expect(scopeChoices(document)[0]).toBe('Whole organization');
  expect(scopeChoices(document)).toHaveLength(11);
  expect(document.querySelector('button[value="approve_person"]')).not.toBeNull();
  expect(document.querySelector('nav a[href="/access"]')).not.toBeNull();
  expect(await screenProblems(text)).toEqual([]);
}

async function areaAdminStaysInTheirArea(db: Database): Promise<void> {
  await scene(db);
  const { document, text } = await documentFor(db, INFRA.email);
  expect(rowsOf(document, 'Who has access')).toEqual([
    `infra.admin${INFRA.email} | admin | 30-39 Infrastructure`,
    `tech.editor${TECH.email} | viewer | 30-39 Infrastructure`,
  ]);
  expect(text).not.toContain('80-89 Tech');
  expect(scopeChoices(document)).toEqual(['30-39 Infrastructure']);
  expect(document.querySelector('button[value="approve_person"]')).toBeNull();
  expect(text).toContain('An org admin approves sign-ins');
  const other = await send(db, INFRA.email, {
    command: 'revoke_role',
    grantId: TECH_GRANT,
  });
  expect(other['reason']).toBe('not_permitted');
  const outside = { personId: FRESH.id, role: 'viewer', scopeKind: 'jd_area', scopeArea: '80-89' };
  const granted = await send(db, INFRA.email, {
    command: 'grant_role',
    ...outside,
    expiresAt: null,
  });
  expect(granted['reason']).toBe('not_permitted');
  expect(await screenProblems(text)).toEqual([]);
}

async function memberSeesOwnGrants(db: Database): Promise<void> {
  await scene(db);
  const { document, text } = await documentFor(db, TECH.email);
  expect(rowsOf(document, 'Who has access')).toEqual([
    `tech.editor${TECH.email} | editor | 80-89 Tech & SLR`,
    `tech.editor${TECH.email} | viewer | 30-39 Infrastructure`,
  ]);
  expect(document.querySelector('form[data-command]')).toBeNull();
  expect(text).not.toContain('Waiting for access');
  expect(text).not.toContain(INFRA.email);
  expect(await screenProblems(text)).toEqual([]);
}

async function grantAndRevokeShowInPlace(db: Database): Promise<void> {
  await scene(db);
  const grant = { personId: FRESH.id, role: 'viewer', scopeKind: 'jd_area', scopeArea: '30-39' };
  const made = await send(db, INFRA.email, {
    command: 'grant_role',
    ...grant,
    expiresAt: null,
  });
  expect(made['status']).toBe('accepted');
  const after = await documentFor(db, INFRA.email);
  expect(rowsOf(after.document, 'Who has access')).toContain(
    `new.mate${FRESH.email} | viewer | 30-39 Infrastructure`,
  );
  expect(rowsOf(after.document, 'Waiting for access').join()).not.toContain(FRESH.email);
  const revoked = await send(db, INFRA.email, {
    command: 'revoke_role',
    grantId: INFRA_VIEW_GRANT,
  });
  expect(revoked['status']).toBe('accepted');
  const last = await documentFor(db, INFRA.email, accessPath({ person: TECH.id }));
  expect(rowsOf(last.document, 'Who has access')).toEqual([]);
  expect(rowsOf(last.document, 'Access history')[0]).toContain(`${INFRA.email} | Revoked`);
  const all = await documentFor(db, INFRA.email);
  expect(rowsOf(all.document, 'Access history').some((row) => row.includes('| Granted'))).toBe(
    true,
  );
}

describe.skipIf(!testServer)('#154 the Access screen', () => {
  it('an org admin sees every grant, who is waiting, and may grant in every scope', () =>
    withAppDatabase(orgAdminSeesEverything));
  it('an area admin sees and changes only the grants on their own area', () =>
    withAppDatabase(areaAdminStaysInTheirArea));
  it('a person with no admin grant sees only their own grants and no controls', () =>
    withAppDatabase(memberSeesOwnGrants));
  it('a grant and a revoke show on the next load, each with its history line', () =>
    withAppDatabase(grantAndRevokeShowInPlace));
});
