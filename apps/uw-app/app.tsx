import { Hono } from 'hono';
import { errorFields } from '@uw/core/log';
import { aclRoutes } from './acl/routes.ts';
import { agentRoutes } from './agents/routes.ts';
import { meRoutes } from './auth/me.ts';
import { withPrincipal } from './auth/principal-middleware.ts';
import { withDatabase } from './database.ts';
import { platformDeps, type AppDeps, type AppEnv } from './deps.ts';
import { commitOf } from './env.ts';
import { healthRoutes } from './health/routes.tsx';
import { mcpRoutes } from './mcp/routes.ts';
import { observe } from './observe.ts';
import { pageRoutes } from './pages/routes.ts';
import { requestLogger } from './request-logger.ts';

export function createApp(deps: AppDeps = platformDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

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

  app.route('/health', healthRoutes(deps));

  app.use(withPrincipal(deps));
  app.route('/api/me', meRoutes());
  app.route('/api/acl', aclRoutes());
  app.route('/api/agents', agentRoutes());
  app.route('/api/pages', pageRoutes());
  app.route('/mcp', mcpRoutes(deps));

  app.get('/', (c) => {
    const commit = commitOf(c.env).slice(0, 7);
    return c.html(
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>unfoldingWord</title>
        </head>
        <body>
          <h1>unfoldingWord</h1>
          <p>Deployed commit {commit}.</p>
        </body>
      </html>,
    );
  });

  return app;
}
