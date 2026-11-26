import type { Context } from 'hono';
import { z } from 'zod';
import {
  areaHomeReplySchema,
  jdAreaSchema,
  lapsedPagesReplySchema,
  pageCategoriesReplySchema,
  pageExportModeSchema,
  pageFavouriteReplySchema,
  pageIndexReplySchema,
  pageTitlesReplySchema,
  pageListQuerySchema,
  pageListReplySchema,
  pageReadReplySchema,
  pageSearchQuerySchema,
  pageSearchReplySchema,
  pageVersionReplySchema,
  pageVersionsReplySchema,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { areaHome } from './area-homes.ts';
import { categoryCounts } from './categories.ts';
import { capabilitiesOn } from './capabilities.ts';
import { favouritesOf, isFavourite } from './favourites.ts';
import { templatesFor } from './templates.ts';
import { lapsedPages, reviewDueFor } from './verification.ts';
import { pageHistory, pageVersion } from './history.ts';
import { listPages, titleIndex } from './listing.ts';
import { recentPages } from './recent.ts';
import { pageExportText } from './export-page.ts';
import { renderPage } from './render-page.ts';
import { backlinksOf } from './links.ts';
import { searchWithSnippets } from './search.ts';
import { readPage } from './store.ts';
import { commitOf } from '../env.ts';

type Reader = { readonly db: Database; readonly actor: Principal; readonly at: Date };
type Read = (c: Context<AppEnv>, reader: Reader) => Promise<Response>;

const versionParam = z.coerce.number().int().min(1);

function accepted(c: Context<AppEnv>, body: unknown): Response {
  c.set('outcome', 'accepted');
  return c.json(body, 200);
}

function reading(read: Read) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    const actor = c.get('principal');
    if (actor === null) return refuse(c, 'unauthenticated');
    return read(c, { db: database.db, actor, at: c.get('now') });
  };
}

const list: Read = async (c, { db, actor, at }) => {
  const query = pageListQuerySchema.safeParse(c.req.query());
  if (!query.success) return refuse(c, 'malformed_command');
  const found = await listPages(db, actor, query.data, at);
  if (found === null) return refuse(c, 'malformed_command');
  return accepted(c, pageListReplySchema.parse(found));
};

async function etagOf(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0'));
  return `"${hex.join('').slice(0, 32)}"`;
}

const index: Read = async (c, { db, actor, at }) => {
  const reply = pageIndexReplySchema.parse({ entries: await titleIndex(db, actor, at) });
  const etag = await etagOf(JSON.stringify(reply));
  c.set('outcome', 'accepted');
  c.header('etag', etag);
  c.header('cache-control', 'private, no-cache');
  if (c.req.header('if-none-match') === etag) return c.body(null, 304);
  return c.json(reply, 200);
};

const recent: Read = async (c, { db, actor, at }) =>
  accepted(c, pageIndexReplySchema.parse({ entries: await recentPages(db, actor, at) }));

const search: Read = async (c, { db, actor, at }) => {
  const query = pageSearchQuerySchema.safeParse(c.req.query());
  if (!query.success) return refuse(c, 'malformed_command');
  const { q, type, area, titles, owner, since, limit } = query.data;
  const results = await searchWithSnippets(
    db,
    actor,
    {
      text: q,
      type: type ?? null,
      area: area ?? null,
      titlesOnly: titles === '1',
      liveOnly: true,
      similar: true,
      owner: owner ?? null,
      since: since ?? null,
      limit,
    },
    at,
  );
  return accepted(c, pageSearchReplySchema.parse({ results }));
};

const one: Read = async (c, { db, actor, at }) => {
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  if (!pageId.success) return refuse(c, 'page_not_found');
  const page = await readPage(db, actor, pageId.data, at);
  if (page === null) return refuse(c, 'page_not_found');
  const rendered =
    c.req.query('format') === 'html' ? await renderPage(db, actor, page, at, commitOf(c.env)) : {};
  const capabilities = capabilitiesOn(actor, page, at);
  return accepted(c, pageReadReplySchema.parse({ page, capabilities, ...rendered }));
};

const exported: Read = async (c, { db, actor, at }) => {
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  const mode = pageExportModeSchema.default('accepted').safeParse(c.req.query('mode'));
  if (!mode.success) return refuse(c, 'malformed_command');
  const page = pageId.success ? await readPage(db, actor, pageId.data, at) : null;
  if (page === null) return refuse(c, 'page_not_found');
  const text = await pageExportText({ db, actor, at }, page, mode.data);
  c.set('outcome', 'accepted');
  return c.body(text, 200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': `attachment; filename="${page.slug}.md"`,
  });
};

const categories: Read = async (c, { db, actor, at }) =>
  accepted(c, pageCategoriesReplySchema.parse({ categories: await categoryCounts(db, actor, at) }));

const favourites: Read = async (c, { db, actor, at }) =>
  accepted(c, pageTitlesReplySchema.parse({ pages: await favouritesOf(db, actor, at) }));

const templates: Read = async (c, { db, actor, at }) =>
  accepted(c, pageTitlesReplySchema.parse({ pages: await templatesFor(db, actor, at) }));

const review: Read = async (c, { db, actor, at }) =>
  accepted(c, lapsedPagesReplySchema.parse({ pages: await lapsedPages(db, actor, at) }));

const reviewDue: Read = async (c, { db, actor, at }) =>
  accepted(c, lapsedPagesReplySchema.parse({ pages: await reviewDueFor(db, actor, at) }));

const area: Read = async (c, { db, actor, at }) => {
  const asked = jdAreaSchema.safeParse(c.req.param('area'));
  const home = asked.success ? await areaHome(db, actor, asked.data, at) : null;
  if (home === null) return refuse(c, 'page_not_found');
  return accepted(c, areaHomeReplySchema.parse(home));
};

const favourite: Read = async (c, { db, actor, at }) => {
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  const page = pageId.success ? await readPage(db, actor, pageId.data, at) : null;
  if (page === null) return refuse(c, 'page_not_found');
  const answer = {
    status: 'accepted',
    pageId: page.id,
    favourite: await isFavourite(db, actor, page.id),
  };
  return accepted(c, pageFavouriteReplySchema.parse(answer));
};

const backlinks: Read = async (c, { db, actor, at }) => {
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  const page = pageId.success ? await readPage(db, actor, pageId.data, at) : null;
  if (page === null) return refuse(c, 'page_not_found');
  const linked = await backlinksOf(db, actor, page.id, at);
  return accepted(c, pageListReplySchema.parse({ pages: linked, next: null }));
};

const versions: Read = async (c, { db, actor, at }) => {
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  const history = pageId.success ? await pageHistory(db, actor, pageId.data, at) : null;
  if (history === null) return refuse(c, 'page_not_found');
  const entries = history.map((entry) => ({ ...entry, savedAt: entry.savedAt.toISOString() }));
  return accepted(c, pageVersionsReplySchema.parse({ versions: entries }));
};

const version: Read = async (c, { db, actor, at }) => {
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  const number = versionParam.safeParse(c.req.param('version'));
  if (!pageId.success || !number.success) return refuse(c, 'page_not_found');
  const found = await pageVersion(db, actor, { pageId: pageId.data, version: number.data }, at);
  if (found === null) return refuse(c, 'page_not_found');
  return accepted(
    c,
    pageVersionReplySchema.parse({ ...found, savedAt: found.savedAt.toISOString() }),
  );
};

export const pageReads = {
  list: reading(list),
  index: reading(index),
  recent: reading(recent),
  search: reading(search),
  backlinks: reading(backlinks),
  categories: reading(categories),
  favourites: reading(favourites),
  favourite: reading(favourite),
  templates: reading(templates),
  review: reading(review),
  reviewDue: reading(reviewDue),
  area: reading(area),
  exported: reading(exported),
  versions: reading(versions),
  version: reading(version),
  one: reading(one),
};
