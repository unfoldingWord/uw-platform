import { Hono } from 'hono';
import { appCss, appCssPath } from '@uw/ui/generated/app-css';
import type { AppEnv } from '../deps.ts';
import { islandsJs, islandsPath, serviceWorkerJs } from '../generated/islands.ts';
import { iconSvg } from './icon.ts';
import { manifest } from './manifest.ts';

const immutable = 'public, max-age=31536000, immutable';
const javascript = 'text/javascript; charset=utf-8';
const shellAssets = [appCssPath, islandsPath, '/manifest.webmanifest', '/assets/icon.svg'];
const workerJs = `const UW_SHELL_ASSETS=${JSON.stringify(shellAssets)};\n${serviceWorkerJs}`;

export function assetRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get(appCssPath, (c) =>
    c.body(appCss, 200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': immutable,
      'x-content-type-options': 'nosniff',
    }),
  );
  routes.get(islandsPath, (c) =>
    c.body(islandsJs, 200, { 'content-type': javascript, 'cache-control': immutable }),
  );
  routes.get('/sw.js', (c) =>
    c.body(workerJs, 200, {
      'content-type': javascript,
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    }),
  );
  routes.get('/manifest.webmanifest', (c) =>
    c.body(JSON.stringify(manifest()), 200, {
      'content-type': 'application/manifest+json',
      'cache-control': 'no-cache',
    }),
  );
  routes.get('/assets/icon.svg', (c) =>
    c.body(iconSvg(), 200, {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=86400',
    }),
  );
  return routes;
}
