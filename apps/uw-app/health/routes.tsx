import { Hono, type Context } from 'hono';
import type { AppDeps, AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { healthListScreen } from '../views/screens/health-list.tsx';
import { healthScreen } from '../views/screens/health.tsx';
import { platformKernel } from '../kernel.ts';
import { AGENT_PLANE_INDICATORS, agentPlaneIndicators } from './agent-plane.ts';
import { cachedHubHealth, type HubHealth } from './hub.ts';
import { healthReport, overallStatus } from './indicators.ts';
import { spendCapOf } from './spend-cap.ts';

type HealthDeps = Pick<AppDeps, 'clock' | 'timers'>;

const drillThrough = `/:indicator{(?:${AGENT_PLANE_INDICATORS.join('|')})$}`;

function platformReport(c: Context<AppEnv>, deps: HealthDeps, hubHealth: HubHealth) {
  const probe = { clock: () => Date.now(), timers: deps.timers, hubHealth };
  return healthReport(c.env, c.get('database'), probe);
}

export function probeRoutes(deps: HealthDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const hubHealth = cachedHubHealth(() => deps.clock.now().getTime());
  routes.get('/', async (c) => c.json(await platformReport(c, deps, hubHealth)));
  return routes;
}

export function healthScreenRoutes(deps: HealthDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const hubHealth = cachedHubHealth(() => deps.clock.now().getTime());
  routes.get('/', async (c) => {
    const database = c.get('database');
    if (database === null) return refuse(c, 'database_not_configured');
    if (c.get('principal') === null) return refuse(c, 'unauthenticated');
    const platform = await platformReport(c, deps, hubHealth);
    const plane = await agentPlaneIndicators({
      kernel: platformKernel(database, deps.clock),
      db: database.db,
      at: c.get('now'),
      cap: spendCapOf(c.env),
    });
    const indicators = [...platform.indicators, ...plane];
    const report = { status: overallStatus(indicators), commit: platform.commit, indicators };
    if (c.req.header('accept')?.includes('text/html')) {
      return healthScreen(c, report);
    }
    return c.json(report, 200, { 'cache-control': 'no-store' });
  });
  routes.get(drillThrough, healthListScreen);
  return routes;
}
