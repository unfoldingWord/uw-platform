import { describe, expect, it } from 'vitest';
import { markPath, wordmarkPath } from '@uw/ui/generated/mark';
import { assetRoutes } from './routes.ts';

const pngSignature = [0x89, 0x50, 0x4e, 0x47];

describe('UI-5 the unfoldingWord mark is served by the Worker', () => {
  it('UI-5 the mark is a PNG at its hashed path, immutable', async () => {
    expect(markPath).toMatch(/^\/assets\/uw-logo-mark-\w{12}\.png$/);
    const response = await assetRoutes().request(markPath);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(pngSignature);
  });

  it('UI-5 the white horizontal logo for the ocean sidebar is a PNG at its hashed path', async () => {
    expect(wordmarkPath).toMatch(/^\/assets\/uw-logo-white-\w{12}\.png$/);
    const response = await assetRoutes().request(wordmarkPath);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(pngSignature);
  });
});
