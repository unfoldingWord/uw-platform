import { jsx } from 'hono/jsx';
import { describe, expect, it } from 'vitest';
import { Shell } from '@uw/ui/components/shell.tsx';
import { appCssPath, manifestColours } from '@uw/ui/generated/app-css';
import { createApp } from '../app.tsx';
import { islandsJs, islandsPath, serviceWorkerJs } from '../generated/islands.ts';
import { recordingDeps } from '../testing/deps.ts';

function request(path: string): Promise<Response> {
  return Promise.resolve(createApp(recordingDeps().deps).request(path, {}, {}));
}

describe('the app is installable', () => {
  it('WB-7 the app is installable: a manifest with a start url, standalone display, theme colours from the tokens and an icon', async () => {
    const response = await request('/manifest.webmanifest');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/manifest+json');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.json()).toEqual({
      name: 'unfoldingWord',
      short_name: 'unfoldingWord',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: manifestColours.theme,
      background_color: manifestColours.background,
      icons: [
        { src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
      ],
    });
    const icon = await request('/assets/icon.svg');
    expect(icon.headers.get('content-type')).toBe('image/svg+xml');
    expect(icon.headers.get('cache-control')).toBe('public, max-age=86400');
    const svg = await icon.text();
    expect(svg).toContain(`fill="${manifestColours.panel}"`);
    expect(svg).toContain(`fill="${manifestColours.panelInk}"`);
    expect(svg).toContain('>uW</text>');
  });

  it('WB-7 the service worker is served from the root with its scope header and no long cache', async () => {
    const response = await request('/sw.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('service-worker-allowed')).toBe('/');
    const body = await response.text();
    const shell = [appCssPath, islandsPath, '/manifest.webmanifest', '/assets/icon.svg'];
    expect(body).toBe(`const UW_SHELL_ASSETS=${JSON.stringify(shell)};\n${serviceWorkerJs}`);
  });
});

describe('the islands bundle and the shell links', () => {
  it('serves the islands bundle at its hashed path, immutable, and 404s any other bundle path', async () => {
    const response = await request(islandsPath);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe(islandsJs);
    const stale = islandsPath.replace(/islands-\w+\.js$/, 'islands-000000000000.js');
    expect((await request(stale)).status).not.toBe(200);
  });

  it('WB-7 the shell links the manifest and the icon', async () => {
    const html = await jsx(Shell, {
      title: 'unfoldingWord',
      nav: [],
      current: '/',
      crumbs: [],
      stylesheet: appCssPath,
      script: islandsPath,
    }).toString();
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"/>');
    expect(html).toContain('<link rel="icon" href="/assets/icon.svg" type="image/svg+xml"/>');
    expect(html).toContain(`<script type="module" src="${islandsPath}"></script>`);
  });
});
