import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../deps.ts';
import { readJson } from './commands.ts';

function reader(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.post('/', async (c) => c.json({ read: await readJson(c) }));
  return app;
}

async function readWith(headers: Record<string, string>): Promise<unknown> {
  const response = await reader().request('/', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'x' }),
  });
  return ((await response.json()) as { read: unknown }).read;
}

describe('a command body is read only from a same-origin JSON request', () => {
  it('reads a JSON body sent from the same origin or by a client that names no site', async () => {
    expect(await readWith({ 'content-type': 'application/json' })).toEqual({ title: 'x' });
    expect(
      await readWith({
        'content-type': 'application/json; charset=utf-8',
        'sec-fetch-site': 'same-origin',
      }),
    ).toEqual({ title: 'x' });
  });

  it('reads nothing from a form post, a text post or a request from another site', async () => {
    for (const headers of [
      { 'content-type': 'application/x-www-form-urlencoded' },
      { 'content-type': 'text/plain' },
      { 'content-type': 'multipart/form-data; boundary=x' },
      {},
      { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' },
      { 'content-type': 'application/json', 'sec-fetch-site': 'none' },
    ]) {
      expect(await readWith(headers), JSON.stringify(headers)).toBeNull();
    }
  });
});
