import { Hono, type Context } from 'hono';
import {
  confirmPageCommandSchema,
  createPageCommandSchema,
  nameCategoryCommandSchema,
  pageCommandAcceptedSchema,
  updatePageCommandSchema,
  type CreatePageCommand,
  type UpdatePageCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { wikiCategoryScreen } from '../views/screens/wiki-category.tsx';
import { searchScreen } from '../views/screens/search.tsx';
import { wikiScreen } from '../views/screens/wiki.tsx';
import { nameCategory } from './categories.ts';
import { confirmPage } from './confirm.ts';
import { pageReads } from './read-handlers.ts';
import { createPage, updatePage, type PageRefusal, type PageResult } from './store.ts';

type Run = (
  db: Database,
  actor: Principal,
  body: unknown,
  traceId: string,
  at: Date,
) => Promise<{ readonly requestId: string; readonly result: PageResult | PageRefusal } | null>;

const handlers = new Map<string, Run>([
  [
    'create_page',
    async (db, actor, body, traceId, at) => {
      const parsed = createPageCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: CreatePageCommand = parsed.data;
      const result = await createPage(db, actor, command, traceId, at);
      return { requestId: command.requestId, result };
    },
  ],
  [
    'update_page',
    async (db, actor, body, traceId, at) => {
      const parsed = updatePageCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: UpdatePageCommand = parsed.data;
      const result = await updatePage(db, actor, command, traceId, at);
      return { requestId: command.requestId, result };
    },
  ],
  [
    'confirm_page',
    async (db, actor, body, traceId, at) => {
      const parsed = confirmPageCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await confirmPage(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
]);

async function handleNameCategory(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const parsed = nameCategoryCommandSchema.safeParse(body);
  if (!parsed.success) return malformed(c, body);
  const result = await nameCategory(database.db, actor, parsed.data, c.get('now'));
  const { requestId } = parsed.data;
  return reply(
    c,
    result.ok
      ? { status: 'accepted', requestId }
      : { status: 'error', requestId, reason: result.reason },
  );
}

async function handleCommand(c: Context<AppEnv>): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const outcome = await run(database.db, actor, body, c.get('traceId'), c.get('now'));
  if (outcome === null) return malformed(c, body);
  const { requestId, result } = outcome;
  if (!result.ok) return reply(c, { status: 'error', requestId, reason: result.reason });
  c.set('outcome', 'accepted');
  const saved = {
    status: 'accepted',
    requestId,
    pageId: result.page.id,
    version: result.page.version,
  };
  return c.json(pageCommandAcceptedSchema.parse(saved), 200);
}

export function pageRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/name_category', handleNameCategory);
  routes.post('/commands/:name', handleCommand);
  routes.get('/', pageReads.list);
  routes.get('/index', pageReads.index);
  routes.get('/recent', pageReads.recent);
  routes.get('/search', pageReads.search);
  routes.get('/:pageId/backlinks', pageReads.backlinks);
  routes.get('/:pageId/versions', pageReads.versions);
  routes.get('/:pageId/versions/:version', pageReads.version);
  routes.get('/:pageId', pageReads.one);
  return routes;
}

export function wikiScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', wikiScreen);
  routes.get('/:category', wikiCategoryScreen);
  return routes;
}

export function searchScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', searchScreen);
  return routes;
}
