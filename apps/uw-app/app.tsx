import { Hono } from 'hono';

export interface Bindings {
  COMMIT_SHA?: string;
}

const unknownCommit = 'unknown';

export function createApp(): Hono<{ Bindings: Bindings }> {
  const app = new Hono<{ Bindings: Bindings }>();

  app.get('/health', (c) => c.json({ status: 'ok', commit: c.env.COMMIT_SHA ?? unknownCommit }));

  app.get('/', (c) => {
    const commit = (c.env.COMMIT_SHA ?? unknownCommit).slice(0, 7);
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
