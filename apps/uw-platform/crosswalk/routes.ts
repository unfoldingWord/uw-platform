import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  declareJdMapCommandSchema,
  placeInCascadeCommandSchema,
  removeJdMapCommandSchema,
  type Principal,
} from '@uw/contracts';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { crosswalkCellScreen } from '../views/screens/crosswalk-cell.tsx';
import { crosswalkNodeScreen } from '../views/screens/crosswalk-node.tsx';
import { crosswalkScreen } from '../views/screens/crosswalk.tsx';
import { declareJdMap, removeJdMap } from './map.ts';
import { placeInCascade } from './placements.ts';
import { cascadeNodeView, crosswalk } from './read.ts';

const uuid = z.uuid();

type Ran = { readonly requestId: string; readonly result: CommandResult } | null;

type Run = (
  db: Database,
  actor: Principal,
  body: unknown,
  traceId: string,
  at: Date,
) => Promise<Ran>;

const declare: Run = async (db, actor, body, traceId, at) => {
  const parsed = declareJdMapCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const result = await declareJdMap(db, actor, parsed.data, traceId, at);
  return { requestId: parsed.data.requestId, result };
};

const remove: Run = async (db, actor, body, traceId, at) => {
  const parsed = removeJdMapCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const result = await removeJdMap(db, actor, parsed.data, traceId, at);
  return { requestId: parsed.data.requestId, result };
};

const place: Run = async (db, actor, body, _traceId, at) => {
  const parsed = placeInCascadeCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const result = await placeInCascade(db, actor, parsed.data, at);
  return { requestId: parsed.data.requestId, result };
};

const handlers = new Map<string, Run>([
  ['declare_jd_map', declare],
  ['remove_jd_map', remove],
  ['place_in_cascade', place],
]);

async function handleCommand(c: Context<AppEnv>): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const ran = await run(database.db, actor, body, c.get('traceId'), c.get('now'));
  if (ran === null) return malformed(c, body);
  return reply(c, toOutcome(ran.requestId, ran.result));
}

async function handleRead(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  return c.json(await crosswalk(database.db, actor, c.get('now')));
}

async function handleNode(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const id = c.req.param('nodeId') ?? '';
  const found = uuid.safeParse(id).success
    ? await cascadeNodeView(database.db, actor, id, c.get('now'))
    : null;
  return found === null ? refuse(c, 'cascade_node_not_found') : c.json(found);
}

function crosswalkRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', handleRead);
  routes.get('/nodes/:nodeId', handleNode);
  routes.post('/commands/:name', handleCommand);
  return routes;
}

function crosswalkScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', crosswalkScreen);
  routes.get('/areas/:area/:tier', crosswalkCellScreen);
  routes.get('/nodes/:nodeId', crosswalkNodeScreen);
  return routes;
}

export function mountCrosswalk(app: Hono<AppEnv>): void {
  app.route('/api/crosswalk', crosswalkRoutes());
  app.route('/crosswalk', crosswalkScreenRoutes());
}
