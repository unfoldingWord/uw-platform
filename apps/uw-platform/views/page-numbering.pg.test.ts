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
  const elsewhere = await save(db, made, '02.05 Travel policy');
  expect(elsewhere.text).toContain('Not saved: 02.05 belongs in category 02, not 01.');
  expect(await jdIdOf(db, made)).toBe('01.20');
  expect((await save(db, made, '01.21 Travel policy')).status).toBe(303);
  expect(await jdIdOf(db, made)).toBe('01.21');
  expect((await save(db, made, '01.21 Travel policy, again')).status).toBe(303);
  expect((await save(db, made, 'Travel policy')).status).toBe(303);
  expect(await jdIdOf(db, made)).toBeNull();
}

describe.skipIf(!testServer)('a page keeps its JD ID in step with the number on its title', () => {
  it('marks the edit form with the page category and itself for the number check', () =>
    withAppDatabase(theEditScreenOffersNumbers));

  it('saves the title number as the JD ID, refuses one taken or from another category', () =>
    withAppDatabase(savingKeepsTheNumberInStep));
});
