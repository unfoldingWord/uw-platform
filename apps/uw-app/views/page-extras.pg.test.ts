import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pageReadReplySchema, type Page } from '@uw/contracts';
import { formatDate } from '@uw/core/dates';
import type { Database } from '@uw/db/client';
import { get, getRaw, person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ORIGIN = { origin: 'http://localhost' };
const DAY_MS = 86_400_000;

type World = {
  readonly editor: { readonly id: string; readonly email: string };
  readonly stranger: string;
  readonly pageId: string;
};

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'extras-editor', 'editor', '00-09');
  const stranger = await person(db, 'extras-stranger', 'editor', '20-29');
  const filed = await fileKnowledge(db, editor.email, '01', {
    title: 'Passwords',
    bodyMd: 'Intro.\n\n## Rules\n\nUse strong ones.\n\n## Travel\n\nAsk first.',
  });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  return { editor, stranger: stranger.email, pageId: filed.pageId };
}

function form(fields: Readonly<Record<string, string>>): URLSearchParams {
  return new URLSearchParams({ requestId: crypto.randomUUID(), ...fields });
}

async function read(db: Database, email: string, pageId: string): Promise<Page> {
  return pageReadReplySchema.parse((await get(db, { email }, `/api/pages/${pageId}`)).body).page;
}

async function exportsWithEmbedsWrittenOut(db: Database): Promise<void> {
  const made = await world(db);
  const host = await fileKnowledge(db, made.editor.email, '01', {
    title: 'Security guide',
    slug: 'security-guide',
    bodyMd: `Read this.\n\n![Passwords](/pages/${made.pageId}#rules)`,
  });
  const sent = await getRaw(db, made.editor.email, `/api/pages/${host.pageId}/export`);
  expect(sent.status).toBe(200);
  expect(sent.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  expect(sent.headers.get('content-disposition')).toBe('attachment; filename="security-guide.md"');
  const text = await sent.text();
  expect(text.startsWith('---\ntitle: "Security guide"\n')).toBe(true);
  expect(text).toContain('**From Passwords:**\n\n## Rules\n\nUse strong ones.');
  expect(text).not.toContain('Ask first.');
  const denied = await getRaw(db, made.stranger, `/api/pages/${host.pageId}/export`);
  expect(denied.status).toBe(404);
  const view = documentOf((await getHtml(db, made.editor.email, `/pages/${host.pageId}`)).text);
  expect(view.querySelector(`main a[href="/api/pages/${host.pageId}/export"]`)).not.toBeNull();
  expect(view.querySelector('main button[data-print]')).not.toBeNull();
}

async function aNewPageStartsFromATemplate(db: Database): Promise<void> {
  const made = await world(db);
  const template = await fileKnowledge(db, made.editor.email, '02', {
    title: 'Meeting notes template',
    bodyMd: '## Attendees\n\n## Decisions',
    frontmatter: { jd_category: '02', tags: ['template', 'meetings'] },
  });
  const blank = documentOf((await getHtml(db, made.editor.email, '/wiki/new')).text);
  const offered = [...blank.querySelectorAll('select[name="template"] option')];
  expect(offered.map((option) => option.textContent)).toEqual([
    'A blank page',
    'Meeting notes template',
  ]);
  const fields = { title: 'Board, March', category: '01', parent: '', template: template.pageId };
  const sent = await postForm(db, made.editor.email, '/wiki/new', form(fields), ORIGIN);
  expect(sent.status).toBe(303);
  const id = /^\/pages\/([0-9a-f-]{36})\/edit$/.exec(sent.headers.get('location') ?? '')?.[1];
  const page = await read(db, made.editor.email, id ?? '');
  expect(page.bodyMd).toBe('## Attendees\n\n## Decisions');
  expect(page.frontmatter).toMatchObject({ jd_category: '01', tags: ['meetings'] });
}

async function verificationIsSetShownAndListedWhenItLapses(db: Database): Promise<void> {
  const made = await world(db);
  const lapsed = await fileKnowledge(db, made.editor.email, '01', {
    title: 'Old procedure',
    frontmatter: {
      jd_category: '01',
      owner: `human:${made.editor.id}`,
      verified_by: `human:${made.editor.id}`,
      verified_until: '2025-08-08',
    },
  });
  const old = await getHtml(db, made.editor.email, `/pages/${lapsed.pageId}`);
  expect(old.text).toContain('Verification lapsed on 2025-08-08.');
  const manage = `/pages/${made.pageId}/manage`;
  const verify = form({ intent: 'verify', expectedVersion: '1', days: '90' });
  const sent = await postForm(db, made.editor.email, manage, verify, ORIGIN);
  expect(sent.status).toBe(303);
  const until = formatDate(new Date(Date.now() + 90 * DAY_MS));
  expect((await read(db, made.editor.email, made.pageId)).frontmatter).toMatchObject({
    verified_by: `human:${made.editor.id}`,
    verified_until: until,
  });
  const fresh = await getHtml(db, made.editor.email, `/pages/${made.pageId}`);
  expect(fresh.text).toContain(`Verified until ${until}`);
  const review = await getHtml(db, made.editor.email, '/wiki/review');
  expect(review.status).toBe(200);
  expect(await screenProblems(review.text)).toEqual([]);
  const listed = [...documentOf(review.text).querySelectorAll('main table tbody tr')];
  expect(listed.map((row) => row.querySelector('a')?.textContent)).toEqual(['Old procedure']);
  expect(listed[0]?.textContent).toContain('2025-08-08');
  const home = documentOf((await getHtml(db, made.editor.email, '/wiki')).text);
  expect(home.querySelector('main a[href="/wiki/review"]')?.textContent).toContain(
    '1 page needs review',
  );
  const elsewhere = await getHtml(db, made.stranger, '/wiki/review');
  expect(documentOf(elsewhere.text).querySelector('main table')).toBeNull();
}

describe.skipIf(!testServer)('#175 pages are exported, templated and kept verified', () => {
  it('exports markdown with front matter and embedded sections written out', () =>
    withAppDatabase(exportsWithEmbedsWrittenOut));

  it('starts a new page from a page tagged template', () =>
    withAppDatabase(aNewPageStartsFromATemplate));

  it('records verification, shows it, and lists pages whose verification lapsed', () =>
    withAppDatabase(verificationIsSetShownAndListedWhenItLapses));
});
