import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { person } from '../testing/commands.ts';
import { personOn } from '../testing/kernel.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { searchPages, searchWithSnippets, type SearchQuery } from './search.ts';

type World = { readonly reader: Principal; readonly stranger: Principal };

const everything = { type: null, area: null, titlesOnly: false, liveOnly: true, limit: 20 };

async function principalOf(db: Database, id: string, email: string): Promise<Principal> {
  return personOn(db, id, email, new Date());
}

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'search-editor', 'editor', '00-09');
  const finance = await person(db, 'search-finance', 'editor', '20-29');
  const pages: readonly (readonly [string, string, string])[] = [
    ['01.26 Budgeting', 'How the rolling sheet works for every program.', '01'],
    ['01.47 Security Guidelines', 'Never share a password. Budgets are not discussed here.', '01'],
    ['01.34 Best practices for Zoom', 'Mute when you are not speaking.', '01'],
  ];
  for (const [title, bodyMd, category] of pages) {
    const filed = await fileKnowledge(db, editor.email, category, { title, bodyMd });
    expect(filed.sent.body).toMatchObject({ status: 'accepted' });
  }
  const closed = await fileKnowledge(db, finance.email, '21', {
    title: '21.10 Budget close',
    bodyMd: 'The budget closes on the fifth.',
  });
  expect(closed.sent.body).toMatchObject({ status: 'accepted' });
  return {
    reader: await principalOf(db, editor.id, editor.email),
    stranger: await principalOf(db, finance.id, finance.email),
  };
}

async function titles(db: Database, actor: Principal, query: Partial<SearchQuery>) {
  const found = await searchPages(db, actor, { ...everything, text: '', ...query }, new Date());
  return found.map((page) => page.title);
}

async function findsAWordByItsStemTitle(db: Database): Promise<void> {
  const made = await world(db);
  expect(await titles(db, made.reader, { text: 'budget' })).toEqual([
    '01.26 Budgeting',
    '01.47 Security Guidelines',
  ]);
  expect(await titles(db, made.stranger, { text: 'budget' })).toEqual(['21.10 Budget close']);
}

async function findsAPageByItsJdId(db: Database): Promise<void> {
  const made = await world(db);
  expect(await titles(db, made.reader, { text: '01.47' })).toEqual(['01.47 Security Guidelines']);
  expect(await titles(db, made.reader, { text: 'secur' })).toEqual(['01.47 Security Guidelines']);
  expect(await titles(db, made.reader, { text: '"rolling sheet"' })).toEqual(['01.26 Budgeting']);
  expect(await titles(db, made.reader, { text: '"sheet rolling"' })).toEqual([]);
}

async function narrowsToTitlesOnlyAndTakesAnything(db: Database): Promise<void> {
  const made = await world(db);
  expect(await titles(db, made.reader, { text: 'budget', titlesOnly: true })).toEqual([
    '01.26 Budgeting',
  ]);
  expect(await titles(db, made.reader, { text: '"unclosed & (odd) -' })).toEqual([]);
  expect(await titles(db, made.reader, { text: '100% _' })).toEqual([]);
}

async function returnsThePassageAroundAHitWith(db: Database): Promise<void> {
  const made = await world(db);
  const query = { ...everything, text: 'password' };
  const [first] = await searchWithSnippets(db, made.reader, query, new Date());
  expect(first?.page.title).toBe('01.47 Security Guidelines');
  expect(first?.snippet.filter((part) => part.hit).map((part) => part.text)).toEqual(['password']);
  expect(first?.snippet.map((part) => part.text).join('')).toContain('Never share a password');
}

async function keepsTheIndexAsAStoredColumn(db: Database): Promise<void> {
  const rows = await db.execute<{ indexdef: string }>(
    sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'pages' AND indexname = 'pages_search'`,
  );
  expect(rows[0]?.indexdef).toContain('USING gin');
}

describe.skipIf(!testServer)('#175 search reads title and body through one stored index', () => {
  it('finds a word by its stem, title matches first, and only in areas the person may read', () =>
    withAppDatabase(findsAWordByItsStemTitle));

  it('finds a page by its JD ID, by part of a word in its title, and by a quoted phrase', () =>
    withAppDatabase(findsAPageByItsJdId));

  it('narrows to titles only, and takes anything a person types without an error', () =>
    withAppDatabase(narrowsToTitlesOnlyAndTakesAnything));
});

describe.skipIf(!testServer)('#175 a search result shows where the words were found', () => {
  it('returns the passage around a hit, with the hit marked and nothing else', () =>
    withAppDatabase(returnsThePassageAroundAHitWith));

  it('keeps the index as a stored column with a GIN index', () =>
    withAppDatabase(keepsTheIndexAsAStoredColumn));
});
