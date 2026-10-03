import { Hono } from 'hono';
import { appCss, appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../deps.ts';

export function assetRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get(appCssPath, (c) =>
    c.body(appCss, 200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    }),
  );
  return routes;
}
