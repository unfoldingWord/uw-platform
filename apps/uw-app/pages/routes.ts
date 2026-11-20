import { Hono, type Context } from 'hono';
import {
  confirmPageCommandSchema,
  createPageCommandSchema,
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
import { confirmPage } from './confirm.ts';
import { addPageReads } from './read-routes.ts';
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
  routes.post('/commands/:name', handleCommand);
  addPageReads(routes);
  return routes;
}
