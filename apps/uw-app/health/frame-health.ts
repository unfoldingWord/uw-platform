import type { MiddlewareHandler } from 'hono';
import type { HealthReport } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { cachedHubHealth } from './hub.ts';
import { screenReport, type HealthDeps } from './screen-report.ts';

const FRAME_HEALTH_CACHE_MS = 30_000;
const FRAME_HEALTH_PEOPLE = 500;

export type FrameHealth = () => Promise<HealthReport | null>;

type Cached = { readonly at: number; readonly report: HealthReport };

export function withFrameHealth(deps: HealthDeps): MiddlewareHandler<AppEnv> {
  const hubHealth = cachedHubHealth(() => deps.clock.now().getTime());
  const cache = new Map<string, Cached>();
  return async (c, next) => {
    c.set('frameHealth', async () => {
      const database = c.get('database');
      const principal = c.get('principal');
      if (database === null || principal === null) return null;
      const now = deps.clock.now().getTime();
      const hit = cache.get(principal.identity);
      if (hit !== undefined && now - hit.at < FRAME_HEALTH_CACHE_MS) return hit.report;
      const report = await screenReport(c, deps, hubHealth, { database, principal });
      if (cache.size >= FRAME_HEALTH_PEOPLE) cache.clear();
      cache.set(principal.identity, { at: now, report });
      return report;
    });
    await next();
  };
}
