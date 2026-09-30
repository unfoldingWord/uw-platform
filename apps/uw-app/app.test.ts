import { describe, expect, it } from 'vitest';
import { createApp } from './app.tsx';

const commit = '0123456789abcdef0123456789abcdef01234567';

describe('uw-app shell', () => {
  it('reports the deployed commit on the health route', async () => {
    const response = await createApp().request('/health', {}, { COMMIT_SHA: commit });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', commit });
  });

  it('reports an unknown commit when none was deployed', async () => {
    const response = await createApp().request('/health', {}, {});
    expect(await response.json()).toEqual({ status: 'ok', commit: 'unknown' });
  });

  it('serves a server-rendered page at the root', async () => {
    const response = await createApp().request('/', {}, { COMMIT_SHA: commit });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('<h1>unfoldingWord</h1>');
    expect(html).toContain(commit.slice(0, 7));
  });

  it('answers an unknown path with a 404 and no exception text', async () => {
    const response = await createApp().request('/nowhere', {}, {});
    expect(response.status).toBe(404);
  });
});
