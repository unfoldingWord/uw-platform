import { describe, expect, it } from 'vitest';
import { appCss, appCssPath } from '@uw/ui/generated/app-css';
import { createApp } from '../app.tsx';
import { recordingDeps } from '../testing/deps.ts';
import { assetRoutes } from './routes.ts';

describe('WB-11 the stylesheet route', () => {
  it('WB-11 the stylesheet is served at its hashed path as text/css, immutable', async () => {
    const response = await assetRoutes().request(appCssPath);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe(appCss);
  });

  it('WB-11 any other asset path is 404', async () => {
    const stale = appCssPath.replace(/app-\w+\.css$/, 'app-000000000000.css');
    for (const path of [
      stale,
      '/assets/app.css',
      '/assets/../app.tsx',
      '/assets/%2e%2e/package.json',
      `${appCssPath}/x`,
      '/assets/',
    ]) {
      expect((await assetRoutes().request(path)).status, path).toBe(404);
    }
  });

  it('is served before the principal middleware, with no credential and no database', async () => {
    const response = await createApp(recordingDeps().deps).request(appCssPath, {}, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
  });

  it('serves only GET and HEAD', async () => {
    const response = await assetRoutes().request(appCssPath, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
