import { Hono } from 'hono';
import type { HealthReport } from '@uw/contracts';
import type { AppDeps, AppEnv } from '../deps.ts';
import { healthReport } from './indicators.ts';

function HealthScreen({ report }: { readonly report: HealthReport }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>unfoldingWord health</title>
      </head>
      <body>
        <main>
          <h1>Health</h1>
          <p>Overall status: {report.status}</p>
          <ul>
            {report.indicators.map((indicator) => (
              <li>
                <strong>{indicator.name}</strong> {indicator.status}: {indicator.detail}
              </li>
            ))}
          </ul>
        </main>
      </body>
    </html>
  );
}

export function healthRoutes(deps: Pick<AppDeps, 'timers'>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get('/', async (c) => {
    const probe = { clock: () => Date.now(), timers: deps.timers };
    const report = await healthReport(c.env, c.get('database'), probe);
    if (c.req.header('accept')?.includes('text/html'))
      return c.html(<HealthScreen report={report} />);
    return c.json(report);
  });
  return routes;
}
