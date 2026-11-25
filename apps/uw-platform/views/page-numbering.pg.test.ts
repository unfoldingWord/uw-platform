import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { pageReadReplySchema, type Page } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { get, person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { getHtml, postForm } from '../testing/views.ts';

const ORIGIN = { origin: 'http://localhost' };

type World = { readonly editor: string; readonly pageId: string };

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'number-editor', 'editor', '00-09');
  const filed = await fileKnowledge(db, editor.email, '01', {
    title: 'Travel policy',
    bodyMd: 'Keep receipts.',
    frontmatter: { jd_category: '01', jd_id: '01.20' },
  });
  await fileKnowledge(db, editor.email, '01', { title: '01.31 Expenses' });
  return { editor: editor.email, pageId: filed.pageId };
}

async function read(db: Database, email: string, pageId: string): Promise<Page> {
  return pageReadReplySchema.parse((await get(db, { email }, `/api/pages/${pageId}`)).body).page;
}

async function save(db: Database, made: World, title: string) {
  const version = (await read(db, made.editor, made.pageId)).version;
  const fields = new URLSearchParams({
    requestId: crypto.randomUUID(),
    expectedVersion: String(version),
    title,
    bodyMd: 'Keep receipts.',
  });
  return postForm(db, made.editor, `/pages/${made.pageId}/edit`, fields, ORIGIN);
}

async function jdIdOf(db: Database, made: World): Promise<unknown> {
  return (await read(db, made.editor, made.pageId)).frontmatter['jd_id'];
}

async function theEditScreenOffersNumbers(db: Database): Promise<void> {
  const made = await world(db);
  const screen = await getHtml(db, made.editor, `/pages/${made.pageId}/edit`);
  const document = new JSDOM(screen.text).window.document;
  const form = document.querySelector('main form[data-jd-numbered]');
  expect(form?.getAttribute('data-jd-category')).toBe('01');
  expect(form?.getAttribute('data-page-id')).toBe(made.pageId);
  expect(form?.querySelector('[data-jd-suggest]')).not.toBeNull();
}

async function savingKeepsTheNumberInStep(db: Database): Promise<void> {
  const made = await world(db);
  expect((await save(db, made, 'Travel policy, 2026')).status).toBe(303);
  expect(await jdIdOf(db, made)).toBe('01.20');
  const taken = await save(db, made, '01.31 Travel policy');
  expect(taken.text).toContain('Not saved: 01.31 is already used by another page.');
  const outside = await save(db, made, '41.41 Travel policy');
  expect(outside.status).toBe(200);
  expect(await jdIdOf(db, made)).toBe('01.20');
  expect((await save(db, made, '01.21 Travel policy')).status).toBe(303);
  expect(await jdIdOf(db, made)).toBe('01.21');
  expect((await save(db, made, '01.21 Travel policy, again')).status).toBe(303);
  expect((await save(db, made, 'Travel policy')).status).toBe(303);
  expect(await jdIdOf(db, made)).toBeNull();
}

async function savingANewCategoryMovesThePage(db: Database): Promise<void> {
  const made = await world(db);
  const before = await read(db, made.editor, made.pageId);
  expect((await save(db, made, '02.05 Travel policy')).status).toBe(303);
  const after = await read(db, made.editor, made.pageId);
  expect(after.frontmatter).toMatchObject({ jd_category: '02', jd_id: '02.05' });
  expect([after.title, after.jdArea, after.bodyMd]).toEqual([
    '02.05 Travel policy',
    '00-09',
    'Keep receipts.',
  ]);
  expect(after.version).toBe(before.version + 2);
  const wiki = new JSDOM((await getHtml(db, made.editor, '/wiki/02')).text).window.document;
  expect(wiki.querySelector(`main a[href="/pages/${made.pageId}"]`)).not.toBeNull();
}

describe.skipIf(!testServer)('a page keeps its JD ID in step with the number on its title', () => {
  it('marks the edit form with the page category and itself for the number check', () =>
    withAppDatabase(theEditScreenOffersNumbers));

  it('saves the title number as the JD ID, and refuses one taken or in an area out of reach', () =>
    withAppDatabase(savingKeepsTheNumberInStep));

  it('moves the page to the category of a new title number when it is saved', () =>
    withAppDatabase(savingANewCategoryMovesThePage));
});
