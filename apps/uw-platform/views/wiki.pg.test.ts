import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { person, post } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';

type World = {
  readonly reader: string;
  readonly admin: string;
  readonly field: string;
  readonly parentId: string;
  readonly childId: string;
};

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

function texts(document: Document, selector: string): string[] {
  return [...document.querySelectorAll(selector)].map((node) => (node.textContent ?? '').trim());
}

async function world(db: Database): Promise<World> {
  const admin = await person(db, 'wiki-admin', 'admin', '00-09');
  const reader = await person(db, 'wiki-reader', 'viewer', '00-09');
  const sixties = await person(db, 'wiki-field-a', 'editor', '60-69');
  const seventies = await person(db, 'wiki-field-b', 'editor', '70-79');
  const parent = await fileKnowledge(db, admin.email, '01', { title: '01.12 Strategic Intents' });
  const child = await fileKnowledge(db, admin.email, '01', {
    title: 'Innovation',
    parentId: parent.pageId,
  });
  await fileKnowledge(db, admin.email, '01', { title: '01.47 Security Guidelines' });
  await fileKnowledge(db, admin.email, '02', { title: '02.16 Beginner cohort' });
  await fileKnowledge(db, sixties.email, '61', { title: '61.01 Chad program' });
  await fileKnowledge(db, seventies.email, '74', { title: '74.02 Vietnam program' });
  expect(child.sent.body).toMatchObject({ status: 'accepted' });
  return {
    reader: reader.email,
    admin: admin.email,
    field: sixties.email,
    parentId: parent.pageId,
    childId: child.pageId,
  };
}

function nameCategory(db: Database, email: string, category: string, name: string) {
  return post(db, email, '/api/pages/commands/name_category', {
    command: 'name_category',
    requestId: crypto.randomUUID(),
    category,
    name,
  });
}

async function browseListsWhatYouMayRead(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.reader, '/wiki');
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector('main h1')?.textContent).toBe('Pages & Wiki');
  expect(texts(document, 'main [data-area] h2')).toEqual(['00-09 unfoldingWord Home']);
  expect(texts(document, 'main [data-area="00-09"] [data-category] > summary')).toEqual([
    '01 3 pages',
    '02 1 page',
  ]);
  const side = document.querySelector('nav a[href="/wiki"]');
  expect(side?.textContent).toContain('Pages & Wiki');
  expect(side?.getAttribute('aria-current')).toBe('page');
}

async function browseShowsEveryPageOpen(db: Database): Promise<void> {
  const made = await world(db);
  const document = documentOf((await getHtml(db, made.reader, '/wiki')).text);
  const categories = [...document.querySelectorAll('main details[data-category]')];
  expect(categories.map((node) => node.getAttribute('data-category'))).toEqual(['01', '02']);
  expect(categories.every((node) => node.hasAttribute('open'))).toBe(true);
  const first = '[data-category="01"] [data-tree]';
  expect(texts(document, `main ${first} > li > a`)).toEqual([
    '01.12 Strategic Intents',
    '01.47 Security Guidelines',
  ]);
  expect(texts(document, `main ${first} > li > ul > li > a`)).toEqual(['Innovation']);
  const child = document.querySelector(`main ${first} a[href="/pages/${made.childId}"]`);
  expect(child).not.toBeNull();
  expect(texts(document, 'main [data-category="02"] [data-tree] a')).toEqual([
    '02.16 Beginner cohort',
  ]);
  expect(document.querySelector('main a[href="/wiki/01"]')?.textContent).toBe('Open category 01');
  expect(document.body.textContent).not.toContain('61.01 Chad program');
}

async function clusterIsOneGroup(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.field, '/wiki');
  const document = documentOf(page.text);
  expect(texts(document, 'main [data-area] h2')).toEqual(['60-79 Field Programs']);
  expect(texts(document, 'main [data-area="60-79"] [data-category] > summary')).toEqual([
    '61 1 page',
  ]);
  const all = await getHtml(db, 'rowan.test@unfoldingword.org', '/wiki');
  expect(texts(documentOf(all.text), 'main [data-area="60-79"] [data-category] > summary')).toEqual(
    ['61 1 page', '74 1 page'],
  );
}

async function categoryShowsItsTree(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.reader, '/wiki/01');
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(texts(document, 'main [data-tree] > li > a')).toEqual([
    '01.12 Strategic Intents',
    '01.47 Security Guidelines',
  ]);
  expect(texts(document, 'main [data-tree] > li > ul > li > a')).toEqual(['Innovation']);
  expect(document.querySelector('main form')).toBeNull();
  expect((await getHtml(db, made.reader, '/wiki/61')).status).toBe(404);
  expect((await getHtml(db, made.reader, '/wiki/6x')).status).toBe(404);
}

async function adminsNameCategories(db: Database): Promise<void> {
  const made = await world(db);
  const refused = await nameCategory(db, made.reader, '01', 'Mine');
  expect(refused.body).toMatchObject({ status: 'error', reason: 'not_permitted' });
  const named = await nameCategory(db, made.admin, '01', 'Knowledge base');
  expect(named.body).toMatchObject({ status: 'accepted' });
  const renamed = await nameCategory(db, made.admin, '01', 'Knowledge Base');
  expect(renamed.body).toMatchObject({ status: 'accepted' });
  const browse = documentOf((await getHtml(db, made.reader, '/wiki')).text);
  expect(texts(browse, 'main [data-area="00-09"] [data-category] > summary')[0]).toBe(
    '01 Knowledge Base 3 pages',
  );
  const category = documentOf((await getHtml(db, made.admin, '/wiki/01')).text);
  expect(category.querySelector('main h1')?.textContent).toBe('01 Knowledge Base');
  expect(category.querySelector('main form[data-command="name_category"]')).not.toBeNull();
}

async function pageSitsInItsPlace(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.reader, `/pages/${made.childId}`);
  const document = documentOf(page.text);
  const crumbs = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] a')].map((link) => [
    (link.textContent ?? '').trim(),
    link.getAttribute('href'),
  ]);
  expect(crumbs).toEqual([
    ['Pages & Wiki', '/wiki'],
    ['01', '/wiki/01'],
    ['01.12 Strategic Intents', `/pages/${made.parentId}`],
  ]);
  const parent = documentOf((await getHtml(db, made.reader, `/pages/${made.parentId}`)).text);
  expect(texts(parent, 'main [data-children] a')).toEqual(['Innovation']);
}

describe.skipIf(!testServer)('#175 Pages & Wiki lists what a person may read', () => {
  it('lists each readable area with its categories and page counts, from the sidebar', () =>
    withAppDatabase(browseListsWhatYouMayRead));

  it('shows every page and sub page on the landing, each category open and closable', () =>
    withAppDatabase(browseShowsEveryPageOpen));

  it('shows 60-79 as one group over its two areas, with only the decades a person may read', () =>
    withAppDatabase(clusterIsOneGroup));

  it('shows a category as a tree of its pages, and nothing of a category out of reach', () =>
    withAppDatabase(categoryShowsItsTree));

  it('lets an admin of the area name a category, and nobody else', () =>
    withAppDatabase(adminsNameCategories));

  it('puts a knowledge page under Pages & Wiki, its category and its parents', () =>
    withAppDatabase(pageSitsInItsPlace));
});
