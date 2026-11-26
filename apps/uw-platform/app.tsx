import { Hono } from 'hono';
import { errorFields } from '@uw/core/log';
import { aclRoutes, directoryScreenRoutes } from './acl/routes.ts';
import { agentRoutes } from './agents/routes.ts';
import { assetRoutes } from './assets/routes.ts';
import { meRoutes } from './auth/me.ts';
import { withPrincipal } from './auth/principal-middleware.ts';
import { platformPersonDeps, type PersonDeps } from './commands/person-deps.ts';
import { harnessRoutes } from './commands/routes.ts';
import { credentialRoutes, credentialScreenRoutes } from './credentials/routes.ts';
import { mountCrosswalk } from './crosswalk/routes.ts';
import { securityHeaders } from './http/security-headers.ts';
import { shareReadsOnPages, withDatabase } from './database.ts';
import { platformDeps, type AppDeps, type AppEnv } from './deps.ts';
import { withFrameHealth } from './health/frame-health.ts';
import { healthScreenRoutes, probeRoutes } from './health/routes.tsx';
import { mcpRoutes } from './mcp/routes.ts';
import { measureRoutes, measureScreenRoutes } from './measures/routes.ts';
import { pushRoutes } from './notify/routes.ts';
import { observe, serverTiming } from './observe.ts';
import { mountCollections } from './collections/routes.ts';
import { mountKnowledgeBase } from './pages/routes.ts';
import { mountExports } from './pdf/routes.ts';
import { requestLogger } from './request-logger.ts';
import { viewRoutes } from './views/routes.tsx';
import { notFound } from './views/screens/not-found.tsx';

function mountContent(app: Hono<AppEnv>): void {
  mountKnowledgeBase(app);
  mountCollections(app);
  mountCrosswalk(app);
  mountExports(app);
  app.route('/api/measures', measureRoutes());
  app.route('/measures', measureScreenRoutes());
}

export function createApp(
  deps: AppDeps = platformDeps,
  person: PersonDeps = platformPersonDeps,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(securityHeaders());
  app.use(observe(deps));
  app.use(withDatabase(deps));
  app.use(serverTiming());
  app.use(shareReadsOnPages());

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
  app.use(withFrameHealth(deps));
  app.route('/api/me', meRoutes());
  app.route('/api/acl', aclRoutes());
  app.route('/api/agents', agentRoutes(deps));
  app.route('/api/credentials', credentialRoutes(deps));
  mountContent(app);
  app.route('/api/push', pushRoutes());
  app.route('/api/harness', harnessRoutes(deps, person));
  app.route('/mcp', mcpRoutes(deps));
  app.route('/health', healthScreenRoutes(deps));
  app.route('/', directoryScreenRoutes());
  app.route('/credentials', credentialScreenRoutes());

  app.route('/', viewRoutes());
  app.notFound((c) =>
    c.req.method === 'GET' && !c.req.path.startsWith('/api/')
      ? notFound(c)
      : c.text('404 Not Found', 404),
  );

  return app;
}
