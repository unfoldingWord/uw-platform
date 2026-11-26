import { Hono, type Context } from 'hono';
import { chartSpecSchema, standardChartKeySchema, type ChartSpec } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { malformed, readJson } from '../http/commands.ts';
import { refuse } from '../http/outcomes.ts';
import { platformKernel } from '../kernel.ts';
import { chartScreen } from '../views/screens/chart.tsx';
import { chartsScreen } from '../views/screens/charts.tsx';
import { chartFormatSchema, chartResponse } from './exports.ts';
import { harnessFreshness } from './freshness.ts';
import { drawChart } from './render.ts';
import { kernelSources } from './sources.ts';
import { standardSpec } from './standard.ts';

async function drawnFile(c: Context<AppEnv>, spec: ChartSpec, name: string): Promise<Response> {
  const format = chartFormatSchema.safeParse(c.req.query('format') ?? 'json');
  if (!format.success) return refuse(c, 'malformed_command');
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const at = c.get('now');
  const kernel = platformKernel(database, { now: () => at });
  const reader = { kernel, caller: { actor, traceId: c.get('traceId') }, at };
  const sources = kernelSources(reader, () => harnessFreshness(database.db, at));
  const drawn = await drawChart(sources, spec, name);
  if (drawn.status === 'error') return refuse(c, drawn.reason);
  return chartResponse(c, drawn.value, format.data, name);
}

async function standardChartFile(c: Context<AppEnv>): Promise<Response> {
  const key = standardChartKeySchema.safeParse(c.req.param('key'));
  if (!key.success) return refuse(c, 'chart_query_not_allowed');
  const spec = standardSpec(key.data, { harnessId: c.req.query('harnessId') ?? '' });
  return drawnFile(c, spec, key.data);
}

async function specChartFile(c: Context<AppEnv>): Promise<Response> {
  const body = await readJson(c);
  const spec = chartSpecSchema.safeParse(body);
  if (!spec.success) return malformed(c, body);
  return drawnFile(c, spec.data, 'chart');
}

export function chartRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post('/render', specChartFile);
  routes.get('/:key', standardChartFile);
  return routes;
}

export function chartScreenRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', chartsScreen);
  routes.get('/:chart', chartScreen);
  return routes;
}
