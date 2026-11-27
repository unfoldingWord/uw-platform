import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedGrant, seedPerson } from '@uw/db/test-seed';
import { post } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm, type Html } from '../testing/views.ts';
import { personPath } from './parts/paths.ts';

const ANA = 'ana.screen@unfoldingword.org';
const BEN = 'ben.screen@unfoldingword.org';
const ADMIN = 'org.screen.admin@unfoldingword.org';
const anaId = '00000000-0000-4000-8000-0000000e3801';
const benId = '00000000-0000-4000-8000-0000000e3802';
const adminId = '00000000-0000-4000-8000-0000000e3803';
const at = '2026-11-20T09:00:00.000Z';
const asked = 'Remind me to call Ana on Friday';
const ORIGIN = { origin: 'http://localhost' };

async function staff(db: Database, id: string, email: string, admin = false): Promise<void> {
  await seedPerson(db, { id, email });
  await seedGrant(db, {
    id: randomUUID(),
    personId: id,
    role: admin ? 'admin' : 'viewer',
    scopeKind: admin ? 'org' : 'jd_area',
    scopeArea: admin ? null : '30-39',
    grantedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
  });
}

function command(db: Database, email: string, body: Record<string, unknown>) {
  return post(db, email, `/api/assistant/commands/${String(body['command'])}`, {
    requestId: randomUUID(),
    ...body,
  });
}

async function seedWork(db: Database, harnessId: string): Promise<string> {
  const requestId = randomUUID();
  const effectId = randomUUID();
  await db.execute(sql`INSERT INTO assistant_requests
      (id, harness_id, person_id, channel, external_id, thread_key, reply_address, note,
       untrusted_parts, received_at, recorded_at)
    VALUES (${requestId}, ${harnessId}, ${anaId}, 'zulip_dm', ${requestId}, 'dm', 'zulip:5005',
      ${asked}, '[]'::jsonb, ${at}::timestamptz, ${at}::timestamptz)`);
  await db.execute(sql`INSERT INTO assistant_effects
      (id, harness_id, request_id, kind, idempotency_key, payload, created_at)
    VALUES (${effectId}, ${harnessId}, ${requestId}, 'reminder_set', ${`r:${effectId}`},
      '{}'::jsonb, ${at}::timestamptz)`);
  await db.execute(sql`INSERT INTO assistant_reminders
      (id, harness_id, person_id, request_id, effect_id, text, due_at, status, created_at)
    VALUES (${randomUUID()}, ${harnessId}, ${anaId}, ${requestId}, ${effectId}, 'Call Ana',
      '2099-01-01T09:00:00.000Z'::timestamptz, 'set', ${at}::timestamptz)`);
  return effectId;
}

async function scene(db: Database): Promise<string> {
  await staff(db, anaId, ANA);
  await staff(db, benId, BEN);
  await staff(db, adminId, ADMIN, true);
  expect(
    (await command(db, ANA, { command: 'enable_assistant', name: 'tabitha' })).body,
  ).toMatchObject({ status: 'accepted' });
  expect((await command(db, ANA, { command: 'grant_assist', expiresAt: null })).body).toMatchObject(
    {
      status: 'accepted',
    },
  );
  const rows = await db.execute<{ harness_id: string }>(
    sql`SELECT harness_id FROM assistant_accounts WHERE person_id = ${anaId}`,
  );
  return seedWork(db, rows[0]?.harness_id ?? '');
}

function documentOf(page: Html): Document {
  return new JSDOM(page.text).window.document;
}

function forms(document: Document): readonly string[] {
  return [...document.querySelectorAll('main form[data-command]')].map(
    (form) => form.getAttribute('data-command') ?? '',
  );
}

async function sound(page: Html): Promise<void> {
  const document = documentOf(page);
  expect(await screenProblems(page.text)).toEqual([]);
  expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
    'light dark',
  );
  expect(document.querySelectorAll('[style]')).toHaveLength(0);
  for (const wide of document.querySelectorAll('main table')) {
    expect(wide.closest('.overflow-x-auto')).not.toBeNull();
  }
}

async function showsThePersonEverything(db: Database): Promise<void> {
  const effectId = await scene(db);
  const page = await getHtml(db, ANA, '/assistant');
  expect(page.status).toBe(200);
  await sound(page);
  const document = documentOf(page);
  const main = document.querySelector('main')?.textContent ?? '';
  for (const text of ['My Assistant', '10.51', asked, 'Call Ana', 'Not created yet']) {
    expect(main).toContain(text);
  }
  expect(forms(document)).toEqual(
    expect.arrayContaining([
      'renew_assist',
      'revoke_assist',
      'undo_assistant_effect',
      'customise_assistant',
      'delete_my_assistant_history',
      'disable_assistant',
    ]),
  );
  const undo = document.querySelector(`input[name="effectId"][value="${effectId}"]`);
  expect(undo?.closest('form')?.getAttribute('data-endpoint')).toBe('/api/assistant/commands');
  expect(forms(document)).not.toContain('set_assistant_budget');
}

async function offersTurningOnToSomeoneWithout(db: Database): Promise<void> {
  await scene(db);
  const page = await getHtml(db, BEN, '/assistant');
  expect(page.status).toBe(200);
  await sound(page);
  const document = documentOf(page);
  expect(forms(document)).toEqual(['enable_assistant']);
  expect(document.querySelector('input[name="name"]')?.getAttribute('maxlength')).toBe('30');
  expect(document.querySelector('main')?.textContent).not.toContain(asked);
}

async function showsAnAdminTheBudgetOnly(db: Database): Promise<void> {
  await scene(db);
  const page = await getHtml(db, ADMIN, `/assistant?person=${anaId}`);
  expect(page.status).toBe(200);
  await sound(page);
  const document = documentOf(page);
  expect(forms(document)).toEqual(['set_assistant_budget']);
  const main = document.querySelector('main')?.textContent ?? '';
  expect(main).toContain('10.51');
  expect(main).not.toContain(asked);
  expect(main).not.toContain('Call Ana');
  expect((await getHtml(db, BEN, `/assistant?person=${anaId}`)).status).toBe(404);
  const profile = documentOf(await getHtml(db, ADMIN, personPath(anaId)));
  expect(profile.querySelector(`a[href="/assistant?person=${anaId}"]`)).not.toBeNull();
}

async function givesAPairingCode(db: Database): Promise<void> {
  await scene(db);
  const page = await postForm(db, ANA, '/assistant/pairing', new URLSearchParams(), ORIGIN);
  expect(page.status).toBe(200);
  const note = documentOf(page).querySelector('[role="note"]')?.textContent ?? '';
  expect(note).toMatch(/within ten minutes: [A-Z0-9]{8}$/);
  const refused = await postForm(db, BEN, '/assistant/pairing', new URLSearchParams(), ORIGIN);
  expect(documentOf(refused).querySelector('[role="note"]')?.textContent).toBe('No assistant');
}

describe.skipIf(!testServer)('PA-7 the My Assistant screen', () => {
  it('shows the person their accounts, permission, requests, effects with undo and reminders', () =>
    withAppDatabase(showsThePersonEverything));
  it('offers someone with no assistant only the turn-on form with its name field', () =>
    withAppDatabase(offersTurningOnToSomeoneWithout));
  it('shows an org admin the accounts and the budget control, and nobody else', () =>
    withAppDatabase(showsAnAdminTheBudgetOnly));
  it('gives the person a one-time Zulip pairing code', () => withAppDatabase(givesAPairingCode));
});
