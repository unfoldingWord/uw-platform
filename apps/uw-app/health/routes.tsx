import { Hono } from 'hono';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { healthListScreen } from '../views/screens/health-list.tsx';
import { healthScreen } from '../views/screens/health.tsx';
import { AGENT_PLANE_INDICATORS } from './agent-plane.ts';
import { cachedHubHealth } from './hub.ts';
import { platformReport, screenReport, type HealthDeps } from './screen-report.ts';

const drillThrough = `/:indicator{(?:${AGENT_PLANE_INDICATORS.join('|')})$}`;

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
    const principal = c.get('principal');
    if (principal === null) return refuse(c, 'unauthenticated');
    const report = await screenReport(c, deps, hubHealth, { database, principal });
    if (c.req.header('accept')?.includes('text/html')) {
      return healthScreen(c, report);
    }
    return c.json(report, 200, { 'cache-control': 'no-store' });
  });
  routes.get(drillThrough, healthListScreen);
  return routes;
}
