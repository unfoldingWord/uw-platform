import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';

type World = {
  readonly editor: string;
  readonly outsider: string;
  readonly first: string;
  readonly middle: string;
  readonly last: string;
  readonly elsewhere: string;
};

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

async function file(db: Database, email: string, category: string, title: string) {
  const filed = await fileKnowledge(db, email, category, { title });
  expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  return filed.pageId;
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'tree-editor', 'editor', '00-09');
  const field = await person(db, 'tree-field', 'editor', '60-69');
  const outsider = await person(db, 'tree-outsider', 'viewer', '00-09');
  return {
    editor: editor.email,
    outsider: outsider.email,
    first: await file(db, editor.email, '01', 'Alpha guide'),
    middle: await file(db, editor.email, '01', 'Bravo guide'),
    last: await file(db, editor.email, '01', 'Charlie guide'),
    elsewhere: await file(db, field.email, '61', 'Field guide'),
  };
}

function sidebarLinks(document: Document): readonly string[] {
  return [...document.querySelectorAll('aside[data-side] nav a')].map(
    (link) => link.textContent?.trim() ?? '',
  );
}

async function treeShowsWhereTheReaderIs(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.editor, `/pages/${made.middle}`);
  expect(page.status).toBe(200);
  const document = documentOf(page.text);
  const current = document.querySelector('aside[data-side] a[aria-current="page"]');
  expect(current?.getAttribute('href')).toBe(`/pages/${made.middle}`);
  const links = sidebarLinks(document);
  expect(links).toEqual(expect.arrayContaining(['Alpha guide', 'Bravo guide', 'Charlie guide']));
  expect(links.join(' ')).not.toContain('Field guide');
  const opened = document.querySelector('aside[data-side] a[href="/wiki"][data-open]');
  expect(opened).not.toBeNull();
}

async function readViewSitsOnASheet(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.editor, `/pages/${made.middle}`);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector('main [data-page-sheet] [data-page-body]')).not.toBeNull();
  expect(document.querySelector('main a[rel="prev"]')?.getAttribute('href')).toBe(
    `/pages/${made.first}`,
  );
  expect(document.querySelector('main a[rel="next"]')?.getAttribute('href')).toBe(
    `/pages/${made.last}`,
  );
  const more = document.querySelector('main details[data-page-more]');
  expect(more?.textContent).toContain('Move, copy or retire');
  expect(more?.textContent).toContain('Export as markdown');
  expect(document.querySelector('main [data-comment-passage]')).not.toBeNull();
  expect(document.querySelector('main a[aria-label="Edit this page"]')).not.toBeNull();
}

async function readerGetsNoManageEntries(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.outsider, `/pages/${made.middle}`);
  const document = documentOf(page.text);
  const more = document.querySelector('main details[data-page-more]');
  expect(more?.textContent).not.toContain('Move, copy or retire');
  expect(document.querySelector('main a[aria-label="Edit this page"]')).toBeNull();
}

async function editModeIsFocused(db: Database): Promise<void> {
  const made = await world(db);
  const edit = await getHtml(db, made.editor, `/pages/${made.middle}/edit`);
  expect(edit.status).toBe(200);
  expect(await screenProblems(edit.text)).toEqual([]);
  const document = documentOf(edit.text);
  expect(document.querySelector('[data-frame]')).toBeNull();
  expect(document.querySelector('aside[data-side]')).toBeNull();
  const form = document.querySelector('main form[data-page-edit]');
  expect(form?.querySelector('[data-edit-bar] button[type="submit"]')?.textContent).toContain(
    'Save',
  );
  expect(form?.querySelector('[data-edit-bar] [data-editor-discard]')).not.toBeNull();
  expect(form?.querySelector('[data-edit-bar] [data-editor-people]')).not.toBeNull();
  expect(form?.querySelector('[data-editor] [data-editor-toolbar]')).not.toBeNull();
  expect(form?.querySelector('input[name="title"]')?.getAttribute('value')).toBe('Bravo guide');
  expect(
    form?.querySelector(`a[data-leave-edit][href="/pages/${made.middle}"]`)?.textContent,
  ).toContain('Back to reading');
}

async function readerStaysInTheFrame(db: Database): Promise<void> {
  const made = await world(db);
  const edit = await getHtml(db, made.outsider, `/pages/${made.middle}/edit`);
  const document = documentOf(edit.text);
  expect(document.querySelector('[data-frame]')).not.toBeNull();
  expect(document.querySelector('main form')).toBeNull();
}

describe.skipIf(!testServer)(
  'ADR 0026 pages are found in the tree, read under a band and edited in focus',
  () => {
    it('opens the page tree at the page being read, showing only areas the reader may read', () =>
      withAppDatabase(treeShowsWhereTheReaderIs));

    it('reads the page on one sheet, with previous and next, More, Comment and Edit', () =>
      withAppDatabase(readViewSitsOnASheet));

    it('offers a reader neither the manage entries nor the pencil', () =>
      withAppDatabase(readerGetsNoManageEntries));

    it('edits in focus mode: no sidebar, one bar with Back, Discard and Save inside the form', () =>
      withAppDatabase(editModeIsFocused));

    it('keeps a person who may not write the page in the ordinary frame', () =>
      withAppDatabase(readerStaysInTheFrame));
  },
);
