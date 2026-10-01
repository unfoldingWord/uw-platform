import { Hono } from 'hono';
import { platformIngestDeps, type IngestDeps, type IngestEnv } from './deps.ts';
import { commitOf } from './env.ts';
import { observe } from './observe.ts';
import { receive } from './receive.ts';

export function createIngestApp(deps: IngestDeps = platformIngestDeps): Hono<IngestEnv> {
  const app = new Hono<IngestEnv>();

  app.use(observe(deps));

  app.onError((_error, c) => {
    c.set('outcome', 'internal_error');
    c.get('logger').error('request failed', { outcome: 'internal_error' });
    return c.json({ status: 'error', reason: 'internal_error' }, 500);
  });

  app.get('/health', (c) => {
    const commit = commitOf(c.env);
    return c.json({
      status: 'ok',
      commit,
      indicators: [{ name: 'commit', status: 'ok', detail: commit }],
    });
  });

  app.post('/webhooks/:source', receive(deps));

  return app;
}
