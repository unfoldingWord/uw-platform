import { Hono, type Context } from 'hono';
import {
  acceptSuggestionCommandSchema,
  adoptTemplateUpdateCommandSchema,
  rejectSuggestionCommandSchema,
  confirmPageCommandSchema,
  copyTemplatePolicyCommandSchema,
  movePageCommandSchema,
  createPageCommandSchema,
  nameCategoryCommandSchema,
  setAreaHomeCommandSchema,
  pageCommandAcceptedSchema,
  pageCommandRefusedSchema,
  updatePageCommandSchema,
  type CreatePageCommand,
  type UpdatePageCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson } from '../http/commands.ts';
import { formGuard } from '../http/form-guard.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { commentFromForm, pageCommentsScreen } from '../views/screens/page-comments.tsx';
import { managePage, pageManageScreen } from '../views/screens/page-manage.tsx';
import { pageVersionScreen, restoreVersion } from '../views/screens/page-version.tsx';
import { wikiCategoryScreen } from '../views/screens/wiki-category.tsx';
import { searchScreen } from '../views/screens/search.tsx';
import { createFromForm, wikiNewScreen } from '../views/screens/wiki-new.tsx';
import { wikiAreaScreen } from '../views/screens/wiki-area.tsx';
import { wikiReviewScreen } from '../views/screens/wiki-review.tsx';
import { wikiPoliciesScreen } from '../views/screens/wiki-policies.tsx';
import { postPolicyForm } from '../views/parts/policy-forms.tsx';
import { decideSuggestion, pageSuggestionScreen } from '../views/screens/page-suggestion.tsx';
import { wikiScreen } from '../views/screens/wiki.tsx';
import { setAreaHome } from './area-homes.ts';
import { nameCategory } from './categories.ts';
import { confirmPage } from './confirm.ts';
import { connectDraft } from './draft-handlers.ts';
import { downloadFile, listPageFiles, uploadFile } from './file-handlers.ts';
import { movePage } from './move.ts';
import { adoptTemplateUpdate, copyTemplatePolicy } from './policy-templates.ts';
import { acceptSuggestion, rejectSuggestion } from './suggestion-decisions.ts';
import {
  dropFavourite,
  handleComment,
  handleResolve,
  keepFavourite,
  listComments,
} from './social-handlers.ts';
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
    'accept_suggestion',
    async (db, actor, body, traceId, at) => {
      const parsed = acceptSuggestionCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await acceptSuggestion(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'reject_suggestion',
    async (db, actor, body, traceId, at) => {
      const parsed = rejectSuggestionCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await rejectSuggestion(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'copy_template_policy',
    async (db, actor, body, traceId, at) => {
      const parsed = copyTemplatePolicyCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await copyTemplatePolicy(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
  [
    'adopt_template_update',
    async (db, actor, body, traceId, at) => {
      const parsed = adoptTemplateUpdateCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await adoptTemplateUpdate(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
    },
  ],
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
    'move_page',
    async (db, actor, body, traceId, at) => {
      const parsed = movePageCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const result = await movePage(db, actor, parsed.data, traceId, at);
      return { requestId: parsed.data.requestId, result };
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

async function handleSetAreaHome(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const parsed = setAreaHomeCommandSchema.safeParse(body);
  if (!parsed.success) return malformed(c, body);
  const result = await setAreaHome(database.db, actor, parsed.data, c.get('now'));
  const { requestId } = parsed.data;
  return reply(
    c,
    result.ok
      ? { status: 'accepted', requestId }
      : { status: 'error', requestId, reason: result.reason },
  );
}

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

function refusedWith(
  c: Context<AppEnv>,
  requestId: string,
  result: PageRefusal | { readonly ok: false; readonly reason: PageRefusal['reason'] },
): Response {
  const detail = 'detail' in result ? result.detail : {};
  if (Object.keys(detail).length === 0) {
    return reply(c, { status: 'error', requestId, reason: result.reason });
  }
  const refused = pageCommandRefusedSchema.parse({
    status: 'error',
    requestId,
    reason: result.reason,
    detail,
  });
  c.set('outcome', result.reason);
  return c.json(refused, 422);
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
  if (!result.ok) return refusedWith(c, requestId, result);
  c.set('outcome', 'accepted');
  const saved = {
    status: 'accepted',
    requestId,
    pageId: result.page.id,
    version: result.page.version,
  };
  return c.json(pageCommandAcceptedSchema.parse(saved), 200);
}

function wikiReads(routes: Hono<AppEnv>): void {
  routes.get('/categories', pageReads.categories);
  routes.get('/favourites', pageReads.favourites);
  routes.get('/templates', pageReads.templates);
  routes.get('/review', pageReads.review);
  routes.get('/review/yours', pageReads.reviewDue);
  routes.get('/areas/:area', pageReads.area);
}

function pageRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/name_category', handleNameCategory);
  routes.post('/commands/set_area_home', handleSetAreaHome);
  routes.post('/commands/comment_page', handleComment);
  routes.post('/commands/resolve_comment', handleResolve);
  routes.post('/commands/:name', handleCommand);
  routes.get('/', pageReads.list);
  routes.get('/index', pageReads.index);
  routes.get('/recent', pageReads.recent);
  routes.get('/search', pageReads.search);
  wikiReads(routes);
  routes.get('/:pageId/backlinks', pageReads.backlinks);
  routes.get('/:pageId/comments', listComments);
  routes.use('/:pageId/favourite', formGuard);
  routes.get('/:pageId/favourite', pageReads.favourite);
  routes.put('/:pageId/favourite', keepFavourite);
  routes.delete('/:pageId/favourite', dropFavourite);
  routes.get('/:pageId/draft', connectDraft);
  routes.get('/:pageId/export', pageReads.exported);
  routes.get('/:pageId/files', listPageFiles);
  routes.get('/:pageId/versions', pageReads.versions);
  routes.get('/:pageId/versions/:version', pageReads.version);
  routes.get('/:pageId', pageReads.one);
  return routes;
}

function wikiScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', wikiScreen);
  routes.use('/new', formGuard);
  routes.get('/new', wikiNewScreen);
  routes.get('/review', wikiReviewScreen);
  routes.get('/policies', wikiPoliciesScreen);
  routes.get('/areas/:area', wikiAreaScreen);
  routes.post('/new', createFromForm);
  routes.get('/:category', wikiCategoryScreen);
  return routes;
}

function pageScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use('/:pageId/comments', formGuard);
  routes.get('/:pageId/comments', pageCommentsScreen);
  routes.post('/:pageId/comments', commentFromForm);
  routes.use('/:pageId/manage', formGuard);
  routes.get('/:pageId/manage', pageManageScreen);
  routes.post('/:pageId/manage', managePage);
  routes.use('/:pageId/policy', formGuard);
  routes.post('/:pageId/policy', postPolicyForm);
  routes.use('/:pageId/suggestions/:suggestionId', formGuard);
  routes.get('/:pageId/suggestions/:suggestionId', pageSuggestionScreen);
  routes.post('/:pageId/suggestions/:suggestionId', decideSuggestion);
  routes.use('/:pageId/versions/:version', formGuard);
  routes.get('/:pageId/versions/:version', pageVersionScreen);
  routes.post('/:pageId/versions/:version', restoreVersion);
  return routes;
}

function searchScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', searchScreen);
  return routes;
}

function fileRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.put('/:fileId', uploadFile);
  routes.get('/:fileId', downloadFile);
  return routes;
}

export function mountKnowledgeBase(app: Hono<AppEnv>): void {
  app.route('/api/pages', pageRoutes());
  app.route('/api/files', fileRoutes());
  app.route('/wiki', wikiScreenRoutes());
  app.route('/pages', pageScreenRoutes());
  app.route('/search', searchScreenRoutes());
}
