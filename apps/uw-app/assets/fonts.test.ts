import { describe, expect, it } from 'vitest';
import { appCss } from '@uw/ui/generated/app-css';
import { fontFiles } from '@uw/ui/generated/fonts';
import { createApp } from '../app.tsx';
import { contentSecurityPolicy } from '../http/security-headers.ts';
import { recordingDeps } from '../testing/deps.ts';
import { assetRoutes } from './routes.ts';

const woff2Signature = [0x77, 0x4f, 0x46, 0x32];

describe('UI-3 the fonts are bundled and served by the Worker', () => {
  it('UI-3 Nunito Sans 400, 600, 800 and JetBrains Mono 400 are each served as woff2, immutable', async () => {
    expect(fontFiles.map((font) => font.path.replace(/-\w{12}\.woff2$/, ''))).toEqual([
      '/assets/fonts/nunito-sans-400',
      '/assets/fonts/nunito-sans-600',
      '/assets/fonts/nunito-sans-800',
      '/assets/fonts/jetbrains-mono-400',
    ]);
    for (const font of fontFiles) {
      const response = await assetRoutes().request(font.path);
      expect(response.status, font.path).toBe(200);
      expect(response.headers.get('content-type')).toBe('font/woff2');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect([...bytes.slice(0, 4)]).toEqual(woff2Signature);
    }
  });

  it('UI-3 the stylesheet declares each face at its own path, and names no font host', () => {
    for (const font of fontFiles) expect(appCss).toContain(`url(${font.path})`);
    expect(appCss).toContain('font-family:Nunito Sans');
    expect(appCss).toContain('font-family:JetBrains Mono');
    expect(appCss).not.toContain('url(//');
    expect(appCss).not.toContain('url(http');
    expect(appCss).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
  });

  it("UI-3 the fonts load under font-src 'self', before any credential", async () => {
    expect(await contentSecurityPolicy('uw.test')).toContain("font-src 'self'");
    const [first] = fontFiles;
    const response = await createApp(recordingDeps().deps).request(first?.path ?? '', {}, {});
    expect(response.status).toBe(200);
  });
});
