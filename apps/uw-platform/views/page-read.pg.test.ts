import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ORIGIN = { origin: 'http://localhost' };
const BODY =
  '## Rules\n\nUse **strong** passwords.\n\n<script>steal()</script>\n\n## Travel\n\nAsk first.';

type World = { readonly editor: string; readonly viewer: string; readonly pageId: string };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'kb-editor', 'editor', '00-09');
  const viewer = await person(db, 'kb-viewer', 'viewer', '00-09');
  const filed = await fileKnowledge(db, editor.email, '01', {
    title: '01.47 Security Guidelines',
    bodyMd: BODY,
  });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  return { editor: editor.email, viewer: viewer.email, pageId: filed.pageId };
}

function form(version: number, bodyMd: string, title = '01.47 Security Guidelines') {
  return new URLSearchParams({
    requestId: crypto.randomUUID(),
    expectedVersion: String(version),
    title,
    bodyMd,
  });
}

async function readViewHasNoFields(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.editor, `/pages/${made.pageId}`);
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector('main form')).toBeNull();
  expect(document.querySelector('main textarea, main input')).toBeNull();
  expect(document.querySelector('[data-page-body] h2#rules')?.textContent).toBe('Rules');
  expect(document.querySelector('[data-page-body] strong')?.textContent).toBe('strong');
  expect(page.text).not.toContain('steal()');
  const pencil = document.querySelector(`main a[href="/pages/${made.pageId}/edit"]`);
  expect(pencil?.getAttribute('aria-label')).toBe('Edit this page');
  const contents = [...document.querySelectorAll('nav[aria-label="On this page"] a')];
  expect(contents.map((link) => link.getAttribute('href'))).toEqual(['#rules', '#travel']);
}

async function viewerGetsNoPencil(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.viewer, `/pages/${made.pageId}`);
  expect(page.status).toBe(200);
  expect(documentOf(page.text).querySelector('main a[href$="/edit"]')).toBeNull();
  const path = `/pages/${made.pageId}/edit`;
  const edit = await getHtml(db, made.viewer, path);
  expect(edit.status).toBe(200);
  expect(documentOf(edit.text).querySelector('main form, main textarea')).toBeNull();
  expect(edit.text).toContain('Editing it needs the editor role in area 00-09.');
  const sent = await postForm(db, made.viewer, path, form(1, 'No.'), ORIGIN);
  expect(sent.text).toContain('Not saved');
  const after = await getHtml(db, made.viewer, `/pages/${made.pageId}`);
  expect(after.text).toContain('Use <strong>strong</strong> passwords.');
}

async function saveReturnsToTheReadView(db: Database): Promise<void> {
  const made = await world(db);
  const edit = await getHtml(db, made.editor, `/pages/${made.pageId}/edit`);
  expect(edit.status).toBe(200);
  expect(await screenProblems(edit.text)).toEqual([]);
  const document = documentOf(edit.text);
  expect(document.querySelector('textarea[name="bodyMd"]')?.textContent).toBe(BODY);
  expect(document.querySelector(`main a[href="/pages/${made.pageId}"]`)?.textContent).toContain(
    'Back to reading',
  );
  const saved = await postForm(
    db,
    made.editor,
    `/pages/${made.pageId}/edit`,
    form(1, '## Rules\n\nNew text.'),
    ORIGIN,
  );
  expect(saved.status).toBe(303);
  expect(saved.headers.get('location')).toBe(`/pages/${made.pageId}?saved=2`);
  const read = await getHtml(db, made.editor, `/pages/${made.pageId}?saved=2`);
  expect(read.text).toContain('Saved as version 2.');
  expect(documentOf(read.text).querySelector('[data-page-body] p')?.textContent).toBe('New text.');
}

async function refusedSaveKeepsWhatWasTyped(db: Database): Promise<void> {
  const made = await world(db);
  const path = `/pages/${made.pageId}/edit`;
  await postForm(db, made.editor, path, form(1, 'First.'), ORIGIN);
  const stale = await postForm(db, made.editor, path, form(1, 'My long edit.'), ORIGIN);
  expect(stale.status).toBe(200);
  expect(stale.text).toContain('Someone saved a newer version');
  const document = documentOf(stale.text);
  expect(document.querySelector('textarea[name="bodyMd"]')?.textContent).toBe('My long edit.');
  expect(document.querySelector('form[data-page-edit]')?.hasAttribute('data-unsaved')).toBe(true);
  const fresh = documentOf((await getHtml(db, made.editor, path)).text);
  expect(fresh.querySelector('form[data-page-edit]')?.hasAttribute('data-unsaved')).toBe(false);
  const read = await getHtml(db, made.editor, `/pages/${made.pageId}`);
  expect(documentOf(read.text).querySelector('[data-page-body] p')?.textContent).toBe('First.');
}

async function editorDecidesInTheBrowser(db: Database): Promise<void> {
  const made = await world(db);
  const markdown = 'Area is measured in m<sup>2</sup>.\n\n<!-- kept for the auditors -->';
  const kept = await fileKnowledge(db, made.editor, '01', { title: 'Units', bodyMd: markdown });
  const edit = documentOf((await getHtml(db, made.editor, `/pages/${kept.pageId}/edit`)).text);
  expect(edit.querySelector('[data-editor] [data-editor-surface]')).not.toBeNull();
  expect(edit.querySelector('script[src^="/assets/editor-"]')).not.toBeNull();
  expect(edit.querySelector('link[href^="/assets/editor-"]')).not.toBeNull();
  expect(edit.querySelector('textarea[name="bodyMd"]')?.textContent).toBe(markdown);
  const asText = await getHtml(db, made.editor, `/pages/${kept.pageId}/edit?as=text`);
  const text = documentOf(asText.text);
  expect(text.querySelector('[data-editor]')).toBeNull();
  expect(text.querySelector('script[src^="/assets/editor-"]')).toBeNull();
  expect(text.querySelector('textarea[name="bodyMd"]')?.textContent).toBe(markdown);
}

describe.skipIf(!testServer)('#175 a page opens as a read view and is edited on purpose', () => {
  it('offers the editor for any page, and leaves the text field to the browser or to ?as=text', () =>
    withAppDatabase(editorDecidesInTheBrowser));

  it('shows the rendered page with a pencil and no field that could change it', () =>
    withAppDatabase(readViewHasNoFields));

  it('gives a reader no pencil, and no form at the edit address', () =>
    withAppDatabase(viewerGetsNoPencil));

  it('saves from edit mode as one version and returns to the read view', () =>
    withAppDatabase(saveReturnsToTheReadView));

  it('keeps what was typed when a save is refused, and leaves the page as it was', () =>
    withAppDatabase(refusedSaveKeepsWhatWasTyped));
});
