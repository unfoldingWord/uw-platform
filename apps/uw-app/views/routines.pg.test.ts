import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@uw/db/client';
import { accepted, callerOf, rowan, softwareHarness } from '../testing/commands.ts';
import { kernelOn } from '../testing/kernel.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, getHtmlWithEnv, postFormWithEnv } from '../testing/views.ts';

const ROWAN = 'rowan.test@unfoldingword.org';
const SECRET = 'routine-secret-shown-once';
const SWITCHED_ON = { ACCESS_ACCOUNT_ID: 'account-1', ACCESS_SERVICE_TOKENS_API_TOKEN: 'key-1' };

type Sent = { readonly url: string; readonly method: string; readonly auth: string | null };

afterEach(() => {
  vi.unstubAllGlobals();
});

function cloudflare(sent: Sent[]): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    sent.push({ url, method, auth: headers.get('authorization') });
    if (method === 'DELETE') return Response.json({ success: true, result: { id: 'cf-token-1' } });
    const result = { id: 'cf-token-1', client_id: 'made.access', client_secret: SECRET };
    return Response.json({ success: true, result });
  });
}

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

const agentsOf = (harnessId: string) => `/harnesses/${harnessId}/agents`;

async function granted(db: Database, harnessId: string): Promise<string> {
  const kernel = kernelOn(db, { now: () => new Date() });
  const input = { harnessId, persona: 'agent:iterate', capability: 'iterate' as const };
  const made = await kernel.delegations.grant(callerOf(await rowan(db)), {
    ...input,
    maxTier: null,
    expiresAt: null,
    supersedes: null,
  });
  return accepted(made).id;
}

function setupForm(delegationId: string): URLSearchParams {
  return new URLSearchParams({ delegationId, name: 'Hourly iterate', device: 'work-laptop' });
}

async function storedText(db: Database): Promise<string> {
  const tables = ['routines', 'service_tokens', 'command_requests', 'harness_events'];
  const dumps = await Promise.all(
    tables.map((table) =>
      db.execute(sql.raw(`SELECT row_to_json(t)::text AS row FROM ${table} t`)),
    ),
  );
  return JSON.stringify(dumps);
}

function routineRows(text: string): readonly string[] {
  const table = [...documentOf(text).querySelectorAll('main table')].find(
    (found) => found.querySelector('caption')?.textContent === 'Routines',
  );
  return [...(table?.querySelectorAll('tbody tr') ?? [])].map((row) => row.textContent ?? '');
}

const SETUP_URL = 'https://api.cloudflare.com/client/v4/accounts/account-1/access/service_tokens';

async function setUpShowsOnce(db: Database, harnessId: string, sent: Sent[]): Promise<void> {
  const delegationId = await granted(db, harnessId);
  const path = `${agentsOf(harnessId)}/routines`;
  const shown = await postFormWithEnv(db, ROWAN, path, setupForm(delegationId), SWITCHED_ON);
  expect(shown.status).toBe(200);
  expect(shown.headers.get('cache-control')).toBe('no-store');
  for (const line of [
    SECRET,
    `x-uw-delegation: ${delegationId}`,
    'x-uw-persona: iterate',
    'x-uw-device: work-laptop',
  ]) {
    expect(shown.text).toContain(line);
  }
  expect(await screenProblems(shown.text)).toEqual([]);
  expect(sent).toEqual([{ url: SETUP_URL, method: 'POST', auth: 'Bearer key-1' }]);
  expect(await storedText(db)).not.toContain(SECRET);
}

async function listedRoutine(db: Database, harnessId: string) {
  const listed = await getHtmlWithEnv(db, ROWAN, agentsOf(harnessId), SWITCHED_ON);
  const routineId = documentOf(listed.text)
    .querySelector('form[action*="/agents/routines/"]')
    ?.getAttribute('action')
    ?.split('/')
    .pop();
  return { rows: routineRows(listed.text), routineId: routineId ?? '' };
}

function changeRoutine(db: Database, harnessId: string, routineId: string, name: string) {
  const path = `${agentsOf(harnessId)}/routines/${routineId}`;
  return postFormWithEnv(db, ROWAN, path, new URLSearchParams({ change: name }), SWITCHED_ON);
}

async function setsUpShowsOnceAndChanges(db: Database): Promise<void> {
  const { harnessId } = await softwareHarness(db);
  const sent: Sent[] = [];
  cloudflare(sent);
  await setUpShowsOnce(db, harnessId, sent);
  const listed = await listedRoutine(db, harnessId);
  expect(listed.rows).toEqual([expect.stringContaining('Hourly iterate')]);
  expect(listed.rows[0]).toContain('Live');
  const paused = await changeRoutine(db, harnessId, listed.routineId, 'pause_routine');
  expect(paused.status).toBe(303);
  expect(paused.headers.get('location')).toBe(`${agentsOf(harnessId)}?routine=pause_routine`);
  expect((await listedRoutine(db, harnessId)).rows[0]).toContain('Paused');
  const revoked = await changeRoutine(db, harnessId, listed.routineId, 'revoke_routine');
  expect(revoked.headers.get('location')).toBe(`${agentsOf(harnessId)}?routine=revoked`);
  expect(sent.at(-1)).toEqual({
    url: `${SETUP_URL}/cf-token-1`,
    method: 'DELETE',
    auth: 'Bearer key-1',
  });
  const after = await getHtmlWithEnv(
    db,
    ROWAN,
    `${agentsOf(harnessId)}?routine=revoked`,
    SWITCHED_ON,
  );
  expect(routineRows(after.text)).toEqual([]);
  expect(after.text).toContain('The routine is revoked and its machine login is deleted.');
}

async function editorCannotSetUp(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const delegationId = await granted(db, scene.harnessId);
  const sent: Sent[] = [];
  cloudflare(sent);
  const page = await getHtmlWithEnv(db, scene.editor.email, agentsOf(scene.harnessId), SWITCHED_ON);
  expect(documentOf(page.text).querySelector('form[action$="/agents/routines"]')).toBeNull();
  const path = `${agentsOf(scene.harnessId)}/routines`;
  const posted = await postFormWithEnv(
    db,
    scene.editor.email,
    path,
    setupForm(delegationId),
    SWITCHED_ON,
  );
  expect(posted.status).toBe(303);
  expect(posted.headers.get('location')).toBe(
    `${agentsOf(scene.harnessId)}?routine=delegation_not_found`,
  );
  expect(sent).toEqual([]);
}

async function switchedOffSaysSo(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  await granted(db, scene.harnessId);
  const page = await getHtml(db, ROWAN, agentsOf(scene.harnessId));
  expect(page.text).toContain('Routines are not switched on here yet');
  expect(documentOf(page.text).querySelector('form[action$="/agents/routines"]')).toBeNull();
}

async function adminWithPermissionSeesForm(db: Database): Promise<void> {
  const scene = await softwareHarness(db);
  const delegationId = await granted(db, scene.harnessId);
  const page = await getHtmlWithEnv(db, ROWAN, agentsOf(scene.harnessId), SWITCHED_ON);
  const form = documentOf(page.text).querySelector('form[action$="/agents/routines"]');
  const option = form?.querySelector(`option[value="${delegationId}"]`);
  expect(option?.textContent).toContain('Iterate');
  expect(await screenProblems(page.text)).toEqual([]);
}

describe.skipIf(!testServer)('#134 routines on the Agents tab', () => {
  it('shows an area admin the setup form for their own permission', () =>
    withAppDatabase(adminWithPermissionSeesForm));
  it('sets up a routine, shows its secret once, then pauses and revokes it', () =>
    withAppDatabase(setsUpShowsOnceAndChanges));
  it('gives an editor no form and refuses their post without calling Cloudflare', () =>
    withAppDatabase(editorCannotSetUp));
  it('says routines are not switched on without the Cloudflare key', () =>
    withAppDatabase(switchedOffSaysSo));
});
