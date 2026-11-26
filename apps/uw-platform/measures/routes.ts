import { Hono, type Context } from 'hono';
import {
  activateDashboardCommandSchema,
  activateMeasureCommandSchema,
  measureRunCommandSchema,
} from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson, toOutcome, type CommandResult } from '../http/commands.ts';
import { refuse, reply } from '../http/outcomes.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { measuresScreen } from '../views/screens/measures.tsx';
import { activateDashboard, activateMeasure } from './activation.ts';
import { dashboardJson, measureJson, panelCsv } from './read-handlers.ts';
import { requestRun } from './run-now.ts';
import { measureRunFrom } from './sandbox.ts';
import { startTrial } from './trial.ts';

type Request = {
  readonly c: Context<AppEnv>;
  readonly db: Database;
  readonly actor: Principal;
  readonly body: unknown;
};

type Ran = { readonly requestId: string; readonly result: CommandResult } | null;

function resultOf(outcome: CommandResult | { readonly ok: true; readonly runId: string }) {
  const result: CommandResult = outcome.ok ? { ok: true } : outcome;
  return result;
}

function sourceOf(c: Context<AppEnv>) {
  return { traceId: c.get('traceId'), at: c.get('now') };
}

async function runCommand({ c, db, actor, body }: Request, name: string): Promise<Ran> {
  const parsed = measureRunCommandSchema.safeParse(body);
  if (!parsed.success || parsed.data.command !== name) return null;
  const command = parsed.data;
  const starter = { binding: measureRunFrom(c.env), traceId: c.get('traceId') };
  const at = c.get('now');
  const outcome =
    command.command === 'run_measure_trial'
      ? await startTrial(db, actor, command, starter, at)
      : await requestRun(db, actor, command, starter, at);
  return { requestId: command.requestId, result: resultOf(outcome) };
}

async function activateCommand({ c, db, actor, body }: Request): Promise<Ran> {
  const parsed = activateMeasureCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const files = c.env.FILES === undefined ? null : bucketFiles(c.env.FILES);
  const outcome = await activateMeasure(db, actor, parsed.data, { ...sourceOf(c), files });
  return { requestId: parsed.data.requestId, result: resultOf(outcome) };
}

async function dashboardCommand({ c, db, actor, body }: Request): Promise<Ran> {
  const parsed = activateDashboardCommandSchema.safeParse(body);
  if (!parsed.success) return null;
  const outcome = await activateDashboard(db, actor, parsed.data, sourceOf(c));
  return { requestId: parsed.data.requestId, result: resultOf(outcome) };
}

const handlers = new Map<string, (request: Request) => Promise<Ran>>([
  ['run_measure_trial', (request) => runCommand(request, 'run_measure_trial')],
  ['run_measure_now', (request) => runCommand(request, 'run_measure_now')],
  ['activate_measure', activateCommand],
  ['activate_dashboard', dashboardCommand],
]);

async function handleCommand(c: Context<AppEnv>): Promise<Response> {
  const run = handlers.get(c.req.param('name') ?? '');
  if (!run) return refuse(c, 'not_wired');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const body = await readJson(c);
  const ran = await run({ c, db: database.db, actor, body });
  if (ran === null) return malformed(c, body);
  return reply(c, toOutcome(ran.requestId, ran.result));
}

export function measureRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/commands/:name', handleCommand);
  routes.get('/dashboards/:dashboardId', dashboardJson);
  routes.get('/dashboards/:dashboardId/panels/:index', panelCsv);
  routes.get('/:measureId', measureJson);
  return routes;
}

export function measureScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', measuresScreen);
  return routes;
}
