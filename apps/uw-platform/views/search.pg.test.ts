import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { getHtml } from '../testing/views.ts';

type World = { readonly reader: string; readonly stranger: string };

function documentOf(text: string): Document {
  return new JSDOM(text).window.document;
}

function texts(document: Document, selector: string): string[] {
  return [...document.querySelectorAll(selector)].map((node) => (node.textContent ?? '').trim());
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'find-editor', 'editor', '00-09');
  const reader = await person(db, 'find-reader', 'viewer', '00-09');
  const stranger = await person(db, 'find-stranger', 'viewer', '20-29');
  await fileKnowledge(db, editor.email, '01', {
    title: '01.26 Budgeting',
    bodyMd: 'How the rolling sheet works for every program.',
  });
  await fileKnowledge(db, editor.email, '01', {
    title: '01.47 Security Guidelines',
    bodyMd: 'Never share a password. Budgets are not discussed here.',
  });
  await seedPage(db, {
    id: '00000000-0000-4000-8000-0000000005e1',
    type: 'skill',
    status: 'active',
    jdArea: '00-09',
    slug: 'budget-skill',
    title: 'Draft a budget',
    bodyMd: 'Steps for drafting a budget.',
    frontmatter: { name: 'budget-skill', description: 'Draft a budget.' },
  });
  return { reader: reader.email, stranger: stranger.email };
}

async function findsAndMarks(db: Database): Promise<void> {
  const made = await world(db);
  const page = await getHtml(db, made.reader, '/search?q=password');
  expect(page.status).toBe(200);
  expect(await screenProblems(page.text)).toEqual([]);
  const document = documentOf(page.text);
  expect(document.querySelector<HTMLInputElement>('main input[name="q"]')?.value).toBe('password');
  expect(texts(document, 'main [data-result] h2')).toEqual(['01.47 Security Guidelines']);
  expect(texts(document, 'main [data-result] mark')).toEqual(['password']);
  expect(document.querySelector('main [data-result] a')?.getAttribute('href')).toMatch(
    /^\/pages\/[0-9a-f-]{36}$/,
  );
  const hidden = await getHtml(db, made.stranger, '/search?q=password');
  expect(texts(documentOf(hidden.text), 'main [data-result] h2')).toEqual([]);
  expect(hidden.text).toContain('No page you can read matches');
}

async function narrowsByTitleAndType(db: Database): Promise<void> {
  const made = await world(db);
  const both = documentOf((await getHtml(db, made.reader, '/search?q=budget')).text);
  expect(texts(both, 'main [data-result] h2')).toEqual([
    '01.26 Budgeting',
    '01.47 Security Guidelines',
  ]);
  const titles = documentOf((await getHtml(db, made.reader, '/search?q=budget&titles=1')).text);
  expect(texts(titles, 'main [data-result] h2')).toEqual(['01.26 Budgeting']);
  expect(titles.querySelector<HTMLInputElement>('main input[name="titles"]')?.checked).toBe(true);
  const every = documentOf((await getHtml(db, made.reader, '/search?q=budget&type=all')).text);
  expect(texts(every, 'main [data-result] h2')).toContain('Draft a budget');
}

async function emptyAndOddQueries(db: Database): Promise<void> {
  const made = await world(db);
  const empty = await getHtml(db, made.reader, '/search');
  expect(empty.status).toBe(200);
  expect(await screenProblems(empty.text)).toEqual([]);
  expect(texts(documentOf(empty.text), 'main [data-result]')).toEqual([]);
  const odd = await getHtml(db, made.reader, `/search?q=${encodeURIComponent('"unclosed & <b>')}`);
  expect(odd.status).toBe(200);
  expect(odd.text).not.toContain('<b>');
}

async function shellCarriesSearchAndSwitcher(db: Database): Promise<void> {
  const made = await world(db);
  const document = documentOf((await getHtml(db, made.reader, '/wiki')).text);
  const form = document.querySelector('header form[role="search"]');
  expect(form?.getAttribute('action')).toBe('/search');
  expect(form?.querySelector('input[name="q"]')).not.toBeNull();
  expect(document.querySelector('header button[data-open-switcher]')?.textContent).toContain(
    'Jump to a page',
  );
  const dialog = document.querySelector('dialog[data-switcher]');
  expect(dialog?.querySelector('input[role="combobox"]')).not.toBeNull();
  expect(dialog?.querySelector('template[data-switcher-row]')).not.toBeNull();
}

describe.skipIf(!testServer)('#175 the search screen', () => {
  it('finds a word in a page body, marks it, and shows only what the person may read', () =>
    withAppDatabase(findsAndMarks));

  it('narrows to titles, and to knowledge pages unless every type is asked for', () =>
    withAppDatabase(narrowsByTitleAndType));

  it('renders with no query and with one a person could not have typed on purpose', () =>
    withAppDatabase(emptyAndOddQueries));

  it('is reachable from every screen, beside the button that opens the Quick Switcher', () =>
    withAppDatabase(shellCarriesSearchAndSwitcher));
});
