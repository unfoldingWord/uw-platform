import { Hono } from 'hono';
import { withDatabase } from './database.ts';
import { platformDeps, type AppDeps, type AppEnv } from './deps.ts';
import { commitOf } from './env.ts';
import { observe } from './observe.ts';

export function createApp(deps: AppDeps = platformDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(observe(deps));
  app.use(withDatabase(deps));

  app.onError((_error, c) => {
    c.set('outcome', 'internal_error');
    c.get('logger').error('request failed', { outcome: 'internal_error' });
    return c.json({ status: 'error', reason: 'internal_error' }, 500);
  });

  app.get('/health', (c) => c.json({ status: 'ok', commit: commitOf(c.env) }));

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
