import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { formatDate } from '@uw/core/dates';
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

async function narrowsByOwnerAndDate(db: Database): Promise<void> {
  const made = await world(db);
  const owner = made.reader.identity;
  const owned = await fileKnowledge(db, made.reader.email ?? '', '01', {
    title: '01.50 Budget owner page',
    bodyMd: 'Budget owned here.',
    frontmatter: { jd_category: '01', owner },
  });
  expect(owned.sent.body).toMatchObject({ status: 'accepted' });
  expect(await titles(db, made.reader, { text: 'budget', owner })).toEqual([
    '01.50 Budget owner page',
  ]);
  await db.execute(sql`UPDATE pages SET updated_at = now() - interval '40 days'
    WHERE title = '01.26 Budgeting'`);
  const since = formatDate(new Date(Date.now() - 31 * 86_400_000));
  expect(await titles(db, made.reader, { text: 'budget', since })).toEqual([
    '01.50 Budget owner page',
    '01.47 Security Guidelines',
  ]);
}

async function aTypoFindsCloseTitles(db: Database): Promise<void> {
  const made = await world(db);
  expect(await titles(db, made.reader, { text: 'buddgeting' })).toEqual([]);
  const close = await searchPages(
    db,
    made.reader,
    { ...everything, text: 'secruity guidlines', similar: true },
    new Date(),
  );
  expect(close.map((page) => page.title)).toEqual(['01.47 Security Guidelines']);
  const typo = await searchWithSnippets(
    db,
    made.reader,
    { ...everything, text: 'buddgeting', similar: true },
    new Date(),
  );
  expect(typo.map((result) => [result.page.title, result.match])).toEqual([
    ['01.26 Budgeting', 'similar_title'],
  ]);
  const outside = await titles(db, made.stranger, { text: 'secruity guidlines', similar: true });
  expect(outside).toEqual([]);
  const exact = await searchWithSnippets(
    db,
    made.reader,
    { ...everything, text: 'budget', similar: true },
    new Date(),
  );
  expect(exact.every((result) => result.match === 'words')).toBe(true);
}

async function keepsTheTrigramIndex(db: Database): Promise<void> {
  const rows = await db.execute<{ indexdef: string }>(
    sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'pages' AND indexname = 'pages_title_trgm'`,
  );
  expect(rows[0]?.indexdef).toContain('gin_trgm_ops');
}

describe.skipIf(!testServer)('#175 a search with a typo still finds the page', () => {
  it('offers pages with a close title when no page holds the words, only where the person may read', () =>
    withAppDatabase(aTypoFindsCloseTitles));

  it('keeps a trigram index on titles', () => withAppDatabase(keepsTheTrigramIndex));
});

describe.skipIf(!testServer)('#175 search narrows by owner and by when a page changed', () => {
  it('finds only the pages a person owns, or that changed since a date', () =>
    withAppDatabase(narrowsByOwnerAndDate));
});

describe.skipIf(!testServer)('#175 a search result shows where the words were found', () => {
  it('returns the passage around a hit, with the hit marked and nothing else', () =>
    withAppDatabase(returnsThePassageAroundAHitWith));

  it('keeps the index as a stored column with a GIN index', () =>
    withAppDatabase(keepsTheIndexAsAStoredColumn));
});
