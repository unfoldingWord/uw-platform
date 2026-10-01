import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  createPageCommandSchema,
  pageSchema,
  updatePageCommandSchema,
  type CreatePageCommand,
  type UpdatePageCommand,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { Principal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { createPage, readPage, updatePage, type PageResult } from './store.ts';

type Run = (
  db: Database,
  actor: Principal,
  body: unknown,
  traceId: string,
  at: Date,
) => Promise<{ readonly requestId: string; readonly result: CommandResult } | null>;

function summarise(result: PageResult): CommandResult {
  return result.ok ? { ok: true } : result;
}

const handlers = new Map<string, Run>([
  [
    'create_page',
    async (db, actor, body, traceId, at) => {
      const parsed = createPageCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: CreatePageCommand = parsed.data;
      const result = await createPage(db, actor, command, traceId, at);
      return { requestId: command.requestId, result: summarise(result) };
    },
  ],
  [
    'update_page',
    async (db, actor, body, traceId, at) => {
      const parsed = updatePageCommandSchema.safeParse(body);
      if (!parsed.success) return null;
      const command: UpdatePageCommand = parsed.data;
      const result = await updatePage(db, actor, command, traceId, at);
      return { requestId: command.requestId, result: summarise(result) };
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
  return reply(c, toOutcome(outcome.requestId, outcome.result));
}

async function handleRead(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  if (!pageId.success) return refuse(c, 'page_not_found');
  const page = await readPage(database.db, actor, pageId.data, c.get('now'));
  if (page === null) return refuse(c, 'page_not_found');
  c.set('outcome', 'accepted');
  return c.json({ page: pageSchema.parse(page) }, 200);
}

export function pageRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handleCommand);
  routes.get('/:pageId', handleRead);
  return routes;
}
