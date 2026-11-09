import { Hono } from 'hono';
import { appCss, appCssPath } from '@uw/ui/generated/app-css';
import { fontFiles } from '@uw/ui/generated/fonts';
import { markBase64, markPath } from '@uw/ui/generated/mark';
import type { AppEnv } from '../deps.ts';
import { islandsJs, islandsPath, serviceWorkerJs } from '../generated/islands.ts';
import { iconSvg } from './icon.ts';
import { manifest } from './manifest.ts';

const immutable = 'public, max-age=31536000, immutable';
const javascript = 'text/javascript; charset=utf-8';
const shellAssets = [
  appCssPath,
  islandsPath,
  '/manifest.webmanifest',
  '/assets/icon.svg',
  markPath,
  ...fontFiles.map((font) => font.path),
];

function assetBytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
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
  for (const font of fontFiles) {
    const bytes = assetBytes(font.base64);
    routes.get(font.path, (c) =>
      c.body(bytes, 200, { 'content-type': 'font/woff2', 'cache-control': immutable }),
    );
  }
  const mark = assetBytes(markBase64);
  routes.get(markPath, (c) =>
    c.body(mark, 200, { 'content-type': 'image/png', 'cache-control': immutable }),
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
