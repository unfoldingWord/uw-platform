import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  lapsedPagesReplySchema,
  pageCategoriesReplySchema,
  pageFavouriteReplySchema,
  pageTitlesReplySchema,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { get, person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

const fixture = createAccessFixture();

type World = {
  readonly editor: { readonly id: string; readonly email: string };
  readonly stranger: string;
  readonly pageId: string;
  readonly templateId: string;
  readonly lapsedId: string;
};

async function world(db: Database): Promise<World> {
  const editor = await person(db, 'wiki-api-editor', 'editor', '00-09');
  const stranger = await person(db, 'wiki-api-stranger', 'editor', '20-29');
  const page = await fileKnowledge(db, editor.email, '01', { title: 'Expense limits' });
  const template = await fileKnowledge(db, editor.email, '02', {
    title: 'Meeting notes template',
    frontmatter: { jd_category: '02', tags: ['template'] },
  });
  const lapsed = await fileKnowledge(db, editor.email, '01', {
    title: 'Old procedure',
    frontmatter: {
      jd_category: '01',
      owner: `human:${editor.id}`,
      verified_until: '2025-08-08',
    },
  });
  return {
    editor,
    stranger: stranger.email,
    pageId: page.pageId,
    templateId: template.pageId,
    lapsedId: lapsed.pageId,
  };
}

async function favour(db: Database, email: string, pageId: string): Promise<void> {
  const keys = await fixture;
  const token = await keys.sign({ email });
  await createApp(postgresDeps(db, keys)).request(
    `/api/pages/${pageId}/favourite`,
    { method: 'PUT', headers: { 'cf-access-jwt-assertion': token, origin: 'http://localhost' } },
    fixtureAccessEnv,
  );
}

async function screensHaveTheirReads(db: Database): Promise<void> {
  const made = await world(db);
  const read = (path: string, email = made.editor.email) => get(db, { email }, path);
  const categories = pageCategoriesReplySchema.parse((await read('/api/pages/categories')).body);
  expect(categories.categories.map((entry) => [entry.code, entry.pages])).toEqual([
    ['01', 2],
    ['02', 1],
  ]);
  const templates = pageTitlesReplySchema.parse((await read('/api/pages/templates')).body);
  expect(templates.pages).toEqual([{ id: made.templateId, title: 'Meeting notes template' }]);
  const review = lapsedPagesReplySchema.parse((await read('/api/pages/review')).body);
  expect(review.pages).toEqual([
    {
      id: made.lapsedId,
      title: 'Old procedure',
      category: '01',
      owner: expect.any(String),
      until: '2025-08-08',
    },
  ]);
  const before = pageFavouriteReplySchema.parse(
    (await read(`/api/pages/${made.pageId}/favourite`)).body,
  );
  expect(before.favourite).toBe(false);
  await favour(db, made.editor.email, made.pageId);
  const after = pageFavouriteReplySchema.parse(
    (await read(`/api/pages/${made.pageId}/favourite`)).body,
  );
  expect(after.favourite).toBe(true);
  const favourites = pageTitlesReplySchema.parse((await read('/api/pages/favourites')).body);
  expect(favourites.pages).toEqual([{ id: made.pageId, title: 'Expense limits' }]);
}

async function readsStayInsideTheReadersAreas(db: Database): Promise<void> {
  const made = await world(db);
  const read = (path: string) => get(db, { email: made.stranger }, path);
  expect(pageCategoriesReplySchema.parse((await read('/api/pages/categories')).body)).toEqual({
    categories: [],
  });
  expect((await read('/api/pages/templates')).body).toEqual({ pages: [] });
  expect((await read('/api/pages/review')).body).toEqual({ pages: [] });
  expect((await read('/api/pages/favourites')).body).toEqual({ pages: [] });
  const hidden = await read(`/api/pages/${made.pageId}/favourite`);
  expect(hidden.status).toBe(404);
  expect((await read(`/api/pages/${randomUUID()}/favourite`)).status).toBe(404);
}

describe.skipIf(!testServer)(
  '#175 every wiki screen is drawn from a read a second client can call',
  () => {
    it('answers categories, templates, needs review, favourites and a favourite flag as JSON', () =>
      withAppDatabase(screensHaveTheirReads));

    it('answers each read only from the areas the person may read', () =>
      withAppDatabase(readsStayInsideTheReadersAreas));
  },
);
