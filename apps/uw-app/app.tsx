import { Hono } from 'hono';
import { errorFields } from '@uw/core/log';
import { aclRoutes } from './acl/routes.ts';
import { agentRoutes } from './agents/routes.ts';
import { assetRoutes } from './assets/routes.ts';
import { meRoutes } from './auth/me.ts';
import { withPrincipal } from './auth/principal-middleware.ts';
import { platformPersonDeps, type PersonDeps } from './commands/person-deps.ts';
import { harnessRoutes } from './commands/routes.ts';
import { securityHeaders } from './http/security-headers.ts';
import { withDatabase } from './database.ts';
import { platformDeps, type AppDeps, type AppEnv } from './deps.ts';
import { healthScreenRoutes, probeRoutes } from './health/routes.tsx';
import { mcpRoutes } from './mcp/routes.ts';
import { pushRoutes } from './notify/routes.ts';
import { observe } from './observe.ts';
import { pageRoutes } from './pages/routes.ts';
import { requestLogger } from './request-logger.ts';
import { viewRoutes } from './views/routes.tsx';
import { notFound } from './views/screens/not-found.tsx';

export function createApp(
  deps: AppDeps = platformDeps,
  person: PersonDeps = platformPersonDeps,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(securityHeaders());
  app.use(observe(deps));
  app.use(withDatabase(deps));

  app.onError((error, c) => {
    c.set('outcome', 'internal_error');
    requestLogger(c).error('request failed', {
      outcome: 'internal_error',
      ...errorFields(error),
    });
    return c.json({ status: 'error', reason: 'internal_error' }, 500);
  });

  app.route('/health/probe', probeRoutes(deps));
  app.route('/', assetRoutes());

  app.use(withPrincipal(deps));
  app.route('/api/me', meRoutes());
  app.route('/api/acl', aclRoutes());
  app.route('/api/agents', agentRoutes());
  app.route('/api/pages', pageRoutes());
  app.route('/api/push', pushRoutes());
  app.route('/api/harness', harnessRoutes(deps, person));
  app.route('/mcp', mcpRoutes(deps));
  app.route('/health', healthScreenRoutes(deps));

  app.route('/', viewRoutes());
  app.notFound((c) =>
    c.req.method === 'GET' && !c.req.path.startsWith('/api/')
      ? notFound(c)
      : c.text('404 Not Found', 404),
  );

  return app;
}
