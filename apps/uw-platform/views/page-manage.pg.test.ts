import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pageReadReplySchema, type Page } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ORIGIN = { origin: 'http://localhost' };
const ID = /^\/pages\/([0-9a-f-]{36})(?:\/edit|\?saved=\d+)$/;

type World = { readonly editor: string; readonly viewer: string; readonly pageId: string };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'manage-editor', 'editor', '00-09');
  const viewer = await person(db, 'manage-viewer', 'viewer', '00-09');
  const filed = await fileKnowledge(db, editor.email, '01', {
    title: 'Travel policy',
    bodyMd: 'Ask first.\n\nKeep receipts.',
    frontmatter: { jd_category: '01', jd_id: '01.20', aliases: ['Travel'] },
  });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  return { editor: editor.email, viewer: viewer.email, pageId: filed.pageId };
}

function form(fields: Readonly<Record<string, string>>): URLSearchParams {
  return new URLSearchParams({ requestId: crypto.randomUUID(), ...fields });
}

async function read(db: Database, email: string, pageId: string): Promise<Page> {
  return pageReadReplySchema.parse((await get(db, { email }, `/api/pages/${pageId}`)).body).page;
}

function createdId(location: string | null): string {
  const id = ID.exec(location ?? '')?.[1];
  if (id === undefined) throw new Error(`no new page in ${String(location)}`);
  return id;
}

function itIsTheEditScreen(document: Document, cancel: string): void {
  const editing = document.querySelector('main form[data-page-edit]');
  expect(editing?.getAttribute('action')).toBe('/wiki/new');
  const bar = editing?.querySelector('[data-edit-bar]');
  expect(bar?.querySelector('button[type="submit"]')?.textContent).toContain('Save');
  expect(bar?.querySelector('a[data-leave-edit]')?.getAttribute('href')).toBe(cancel);
  expect(editing?.querySelector('[data-editor]')).not.toBeNull();
  expect(editing?.querySelector('textarea[name="bodyMd"]')).not.toBeNull();
}

async function aNewPageIsWrittenWhereItIsEdited(db: Database): Promise<void> {
  const made = await world(db);
  const blank = await getHtml(db, made.editor, '/wiki/new?title=Per%20diem%20rates&category=02');
  expect(blank.status).toBe(200);
  expect(await screenProblems(blank.text)).toEqual([]);
  const document = documentOf(blank.text);
  itIsTheEditScreen(document, '/wiki/02');
  expect(document.querySelector<HTMLInputElement>('input[name="title"]')?.value).toBe(
    'Per diem rates',
  );
  expect(document.querySelector<HTMLInputElement>('aside input[name="category"]')?.value).toBe(
    '02',
  );
  const fields = { title: 'Per diem rates', category: '02', parent: '', bodyMd: '## Rates' };
  const sent = await postForm(db, made.editor, '/wiki/new', form(fields), ORIGIN);
  expect(sent.status).toBe(303);
  const location = sent.headers.get('location');
  expect(location).toMatch(/^\/pages\/[0-9a-f-]{36}\?saved=1$/);
  const page = await read(db, made.editor, createdId(location));
  expect([page.title, page.type, page.jdArea, page.status, page.bodyMd]).toEqual([
    'Per diem rates',
    'knowledge',
    '00-09',
    'active',
    '## Rates',
  ]);
  expect(page.frontmatter).toMatchObject({ jd_category: '02' });
  expect(page.slug).toMatch(/^per-diem-rates-[0-9a-f]{8}$/);
}

async function aNewPageIsRefusedWithWhatWasTyped(db: Database): Promise<void> {
  const made = await world(db);
  const fields = { title: 'Not mine to file', category: '61', parent: '', bodyMd: 'Kept.' };
  const refused = await postForm(db, made.editor, '/wiki/new', form(fields), ORIGIN);
  expect(refused.status).toBe(200);
  expect(refused.text).toContain('Not created');
  expect(
    documentOf(refused.text).querySelector<HTMLInputElement>('input[name="title"]')?.value,
  ).toBe('Not mine to file');
  expect(documentOf(refused.text).querySelector('textarea[name="bodyMd"]')?.textContent).toBe(
    'Kept.',
  );
  const odd = await postForm(
    db,
    made.editor,
    '/wiki/new',
    form({ ...fields, category: 'x' }),
    ORIGIN,
  );
  expect(odd.text).toContain('A category is two digits');
  const under = await getHtml(db, made.editor, `/wiki/new?parent=${made.pageId}`);
  const prefilled = documentOf(under.text);
  expect(prefilled.querySelector<HTMLInputElement>('input[name="category"]')?.value).toBe('01');
  expect(prefilled.querySelector<HTMLInputElement>('input[name="parent"]')?.value).toBe(
    made.pageId,
  );
}

async function managingMovesAndCopies(db: Database): Promise<void> {
  const made = await world(db);
  const path = `/pages/${made.pageId}/manage`;
  const screen = await getHtml(db, made.editor, path);
  expect(screen.status).toBe(200);
  expect(await screenProblems(screen.text)).toEqual([]);
  const asViewer = await getHtml(db, made.viewer, path);
  expect(asViewer.status).toBe(200);
  expect(documentOf(asViewer.text).querySelector('main form')).toBeNull();
  expect(asViewer.text).toContain('needs the editor role in area 00-09');
  const refused = form({ intent: 'retire', expectedVersion: '1' });
  await postForm(db, made.viewer, path, refused, ORIGIN);
  expect((await read(db, made.editor, made.pageId)).status).toBe('active');
  const move = form({ intent: 'move', expectedVersion: '1', category: '03', parent: '' });
  const moved = await postForm(db, made.editor, path, move, ORIGIN);
  expect([moved.status, moved.headers.get('location')]).toEqual([
    303,
    `/pages/${made.pageId}?saved=2`,
  ]);
  expect((await read(db, made.editor, made.pageId)).frontmatter).toMatchObject({
    jd_category: '03',
    jd_id: null,
  });
  const copy = form({ intent: 'copy', expectedVersion: '2' });
  const copied = await postForm(db, made.editor, path, copy, ORIGIN);
  const twin = await read(db, made.editor, createdId(copied.headers.get('location')));
  expect([twin.title, twin.bodyMd]).toEqual([
    'Copy of Travel policy',
    'Ask first.\n\nKeep receipts.',
  ]);
  expect(twin.frontmatter).toMatchObject({ jd_category: '03', jd_id: null, aliases: [] });
}

async function retiringHidesAndRestoringShows(db: Database): Promise<void> {
  const made = await world(db);
  const path = `/pages/${made.pageId}/manage`;
  const retire = form({ intent: 'retire', expectedVersion: '1' });
  const retired = await postForm(db, made.editor, path, retire, ORIGIN);
  expect(retired.status).toBe(303);
  const shown = await getHtml(db, made.editor, `/pages/${made.pageId}`);
  expect(shown.text).toContain('This page is retired.');
  expect((await getHtml(db, made.editor, '/wiki/01')).text).not.toContain('>Travel policy<');
  const again = form({ intent: 'retire', expectedVersion: '1' });
  const stale = await postForm(db, made.editor, path, again, ORIGIN);
  expect(stale.status).toBe(200);
  expect(stale.text).toContain('Not done');
  const restore = form({ intent: 'restore', expectedVersion: '2' });
  await postForm(db, made.editor, path, restore, ORIGIN);
  expect((await read(db, made.editor, made.pageId)).status).toBe('active');
  expect((await getHtml(db, made.editor, '/wiki/01')).text).toContain('>Travel policy<');
}

async function anOlderVersionIsComparedAndRestored(db: Database): Promise<void> {
  const made = await world(db);
  const edit = form({
    expectedVersion: '1',
    title: 'Travel policy',
    bodyMd: 'Ask first.\n\nKeep every receipt.',
  });
  await postForm(db, made.editor, `/pages/${made.pageId}/edit`, edit, ORIGIN);
  const path = `/pages/${made.pageId}/versions/1`;
  const old = await getHtml(db, made.viewer, path);
  expect(old.status).toBe(200);
  expect(await screenProblems(old.text)).toEqual([]);
  const document = documentOf(old.text);
  expect(document.querySelector('[data-page-body]')?.textContent).toContain('Keep receipts.');
  expect(document.querySelector('[data-changes] del')?.textContent).toBe('Keep receipts.');
  expect(document.querySelector('[data-changes] ins')?.textContent).toBe('Keep every receipt.');
  expect(document.querySelector('main form')).toBeNull();
  expect((await getHtml(db, made.viewer, `/pages/${made.pageId}/versions/9`)).status).toBe(404);
  const asEditor = documentOf((await getHtml(db, made.editor, path)).text);
  expect(asEditor.querySelector('main form button')?.textContent).toContain('Restore this version');
  const refused = await postForm(db, made.viewer, path, form({ expectedVersion: '2' }), ORIGIN);
  expect(refused.status).toBe(404);
  const restored = await postForm(db, made.editor, path, form({ expectedVersion: '2' }), ORIGIN);
  expect(restored.headers.get('location')).toBe(`/pages/${made.pageId}?saved=3`);
  expect((await read(db, made.editor, made.pageId)).bodyMd).toBe('Ask first.\n\nKeep receipts.');
}

async function theReadViewLinksToAllOfIt(db: Database): Promise<void> {
  const made = await world(db);
  const page = documentOf((await getHtml(db, made.editor, `/pages/${made.pageId}`)).text);
  const hrefs = [...page.querySelectorAll('main a')].map((link) => link.getAttribute('href'));
  expect(hrefs).toContain(`/pages/${made.pageId}/manage`);
  expect(hrefs).toContain(`/wiki/new?parent=${made.pageId}`);
  expect(hrefs).toContain(`/pages/${made.pageId}/versions/1`);
  const reader = documentOf((await getHtml(db, made.viewer, `/pages/${made.pageId}`)).text);
  const seen = [...reader.querySelectorAll('main a')].map((link) => link.getAttribute('href'));
  expect(seen).not.toContain(`/pages/${made.pageId}/manage`);
  expect(seen).toContain(`/pages/${made.pageId}/versions/1`);
  const wiki = documentOf((await getHtml(db, made.editor, '/wiki/01')).text);
  expect(wiki.querySelector('main a[href="/wiki/new?category=01"]')).not.toBeNull();
}

describe.skipIf(!testServer)('#175 pages are created, moved, copied, retired and restored', () => {
  it('writes a new page on the edit screen and files it on the first save', () =>
    withAppDatabase(aNewPageIsWrittenWhereItIsEdited));

  it('keeps what was typed when a new page is refused, and files under a page', () =>
    withAppDatabase(aNewPageIsRefusedWithWhatWasTyped));

  it('moves and copies from the manage screen', () => withAppDatabase(managingMovesAndCopies));

  it('retires a page out of lists and restores it', () =>
    withAppDatabase(retiringHidesAndRestoringShows));

  it('shows an older version, what changed since, and restores it as a new version', () =>
    withAppDatabase(anOlderVersionIsComparedAndRestored));

  it('links the read view to managing, to a new page under it and to its versions', () =>
    withAppDatabase(theReadViewLinksToAllOfIt));
});
