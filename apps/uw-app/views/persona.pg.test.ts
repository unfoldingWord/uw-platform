import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { command, softwareHarness, type Scene } from '../testing/commands.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const IAN = 'ian.lindsley@unfoldingword.org';
const ORIGIN = { origin: 'http://localhost' };

const body = [
  '---',
  'name: builder',
  'description: Builder turns an approved plan into commits.',
  '---',
  'Claim the item, do the work, submit it.',
].join('\n');

async function personaPage(db: Database, harnessId: string): Promise<string> {
  const pageId = randomUUID();
  const toolset = ['read_page', 'claim_item'];
  await seedPage(db, {
    id: pageId,
    type: 'persona',
    status: 'suggested',
    jdArea: '80-89',
    slug: 'persona-builder',
    title: 'Builder',
    bodyMd: body,
    frontmatter: {
      identity: 'agent:builder',
      owner: 'human:00000000-0000-4000-8000-000000000001',
      harness: harnessId,
      toolset,
      run_shape: 'workflow-run',
      engine: 'claude-messages',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      budget: { monthly_minor: 20000, currency: 'USD' },
      capability: 'build',
      requires_tools: toolset,
      status: 'suggested',
    },
  });
  return pageId;
}

async function pageRow(db: Database, pageId: string) {
  const rows = await db.execute<{
    status: string;
    version: number;
    toolset: string[];
    requires: string[];
  }>(
    sql`SELECT status, version, frontmatter->'toolset' AS toolset, frontmatter->'requires_tools' AS requires FROM pages WHERE id = ${pageId}`,
  );
  return rows[0];
}

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function scene(db: Database): Promise<{ scene: Scene; pageId: string }> {
  const made = await softwareHarness(db);
  return { scene: made, pageId: await personaPage(db, made.harnessId) };
}

async function opensOnDashboard(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const page = await getHtml(db, IAN, `/personas/${pageId}`);
  expect(page.status).toBe(200);
  const document = documentOf(page.text);
  expect(document.querySelector('h1')?.textContent).toBe('Builder');
  const labels = [...document.querySelectorAll('dt')].map((term) => term.textContent);
  expect(labels).toEqual([
    'Runs today',
    'Spend today',
    'Escalation rate',
    'Gate refusals today',
    'Premises held today',
    'Writes today',
  ]);
  expect(page.text).toContain('No runs ended today');
  const missing = await getHtml(db, IAN, `/personas/${randomUUID()}`);
  expect(missing.status).toBe(404);
}

async function activates(db: Database): Promise<void> {
  const { scene: made, pageId } = await scene(db);
  const asEditor = documentOf((await getHtml(db, made.editor.email, `/personas/${pageId}`)).text);
  expect(asEditor.querySelector('form[data-command="activate_persona"]')).toBeNull();
  const document = documentOf((await getHtml(db, IAN, `/personas/${pageId}`)).text);
  const form = document.querySelector('form[data-command="activate_persona"]');
  expect(form?.getAttribute('data-harness')).toBe(made.harnessId);
  const field = (name: string) =>
    form?.querySelector(`input[name="${name}"]`)?.getAttribute('value') ?? '';
  expect(field('pageId')).toBe(pageId);
  const stale = await command(db, { email: IAN }, made.harnessId, 'activate_persona', {
    requestId: randomUUID(),
    pageId,
    expectedVersion: Number(field('expectedVersion')) + 1,
  });
  expect(stale.body['reason']).toBe('stale_version');
  const done = await command(db, { email: IAN }, made.harnessId, 'activate_persona', {
    requestId: randomUUID(),
    pageId,
    expectedVersion: Number(field('expectedVersion')),
  });
  expect(done.body['status']).toBe('accepted');
  expect(await pageRow(db, pageId)).toMatchObject({ status: 'active', version: 2 });
  const after = documentOf((await getHtml(db, IAN, `/personas/${pageId}`)).text);
  expect(after.querySelector('form[data-command="activate_persona"]')).toBeNull();
}

function toolsetForm(verbs: readonly string[], expectedVersion: number): URLSearchParams {
  const form = new URLSearchParams({
    expectedVersion: String(expectedVersion),
    requestId: randomUUID(),
  });
  for (const verb of verbs) form.append('verb', verb);
  return form;
}

async function savesToolset(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const form = toolsetForm(['read_page', 'search_pages', 'list_gifts', 'approve_gate'], 1);
  const saved = await postForm(db, IAN, `/personas/${pageId}/toolset`, form, ORIGIN);
  expect(saved.status).toBe(200);
  expect(saved.text).toContain('Done.');
  expect(await pageRow(db, pageId)).toEqual({
    status: 'suggested',
    version: 2,
    toolset: ['search_pages', 'read_page'],
    requires: ['search_pages', 'read_page'],
  });
  const stale = await postForm(db, IAN, `/personas/${pageId}/toolset`, toolsetForm([], 1), ORIGIN);
  expect(stale.text).toContain('Stale version');
  expect((await pageRow(db, pageId))?.version).toBe(2);
}

async function crossSite(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const form = toolsetForm(['read_page'], 1);
  const refused = await postForm(db, IAN, `/personas/${pageId}/toolset`, form, {
    origin: 'https://evil.example',
  });
  expect(refused.status).toBe(403);
  const none = await postForm(db, IAN, `/personas/${pageId}/toolset`, form, {});
  expect(none.status).toBe(403);
  expect((await pageRow(db, pageId))?.version).toBe(1);
}

async function rendersCleanly(db: Database): Promise<void> {
  const { pageId } = await scene(db);
  const page = await getHtml(db, IAN, `/personas/${pageId}`);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector('meta[name="color-scheme"]')?.getAttribute('content')).toBe(
    'light dark',
  );
  const kindled = [...document.querySelectorAll('main [class*="kindle"]')];
  expect(kindled.map((element) => [element.tagName, element.textContent])).toEqual([
    ['BUTTON', 'Activate'],
  ]);
}

describe.skipIf(!testServer)('the persona view', () => {
  it('the persona view declares both colour schemes and names every control, and Kindle marks only Activate', () =>
    withAppDatabase(rendersCleanly));
  it('PE-4 a persona page opens on its dashboard', () => withAppDatabase(opensOnDashboard));
  it('PE-3 the Activate form activates the persona through the command dispatcher and shows the outcome in place', () =>
    withAppDatabase(activates));
  it('PE-2 the toolset form saves only offered verbs and requires_tools follows', () =>
    withAppDatabase(savesToolset));
  it('a toolset post from another origin, or with no origin, is refused', () =>
    withAppDatabase(crossSite));
});
