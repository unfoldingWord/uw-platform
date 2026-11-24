import { Hono, type Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { personPrincipal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import type { Bindings } from '../env.ts';
import { fakeBrowser } from '../testing/browser.ts';
import type { Printed } from './print-document.ts';
import { pdfOfScreen, screenPrinted } from './screen.ts';

const reader = personPrincipal({
  personId: '5b0c3a4e-7d1f-4c55-9a43-2f1e8d6b7a10',
  email: 'reader@example.org',
  grants: [],
  interactive: true,
});
const NOW = new Date('2026-11-24T15:30:00.000Z');
const SHA = 'f'.repeat(64);
const BODY = '<h1>Open tasks</h1><p>Two rows</p>';

type Answer = (c: Context<AppEnv>) => Promise<Response>;

function app(answer: Answer, signedIn = true): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use(async (c, next) => {
    c.set('principal', signedIn ? reader : null);
    c.set('now', NOW);
    c.set('database', null);
    c.set('outcome', null);
    await next();
  });
  routes.get('/collections/tasks/views/v1', answer);
  return routes;
}

const viewPrinted: Printed = {
  reference: 'tasks/Open tasks',
  filters: ['status is open'],
  hashInput: { kind: 'hash', sourceSha256: SHA, withheld: false },
};

async function exported(env: Bindings, printed: Printed = viewPrinted, signedIn = true) {
  const answer: Answer = (c) => pdfOfScreen(c, 'Open tasks: November', BODY, printed);
  const url = 'https://app.example.org/collections/tasks/views/v1?month=2026-11&format=pdf';
  return app(answer, signedIn).request(url, {}, env);
}

describe('#198 a screen that cannot print refuses with a closed-set reason', () => {
  it('#198 refuses not_wired when no browser is bound', async () => {
    const response = await exported({ APP_ORIGIN: 'https://app.example.org' });
    expect([response.status, await response.json()]).toEqual([
      404,
      { status: 'error', reason: 'not_wired' },
    ]);
  });

  it('#198 refuses database_not_configured when it has nowhere to count the render', async () => {
    const browser = fakeBrowser();
    const response = await exported({ BROWSER: browser, APP_ORIGIN: 'https://app.example.org' });
    expect([response.status, await response.json()]).toEqual([
      503,
      { status: 'error', reason: 'database_not_configured' },
    ]);
    expect(browser.calls()).toEqual([]);
  });

  it('#198 refuses unauthenticated when no one is signed in', async () => {
    const response = await exported({ BROWSER: fakeBrowser() }, viewPrinted, false);
    expect(response.status).toBe(401);
  });
});

describe('#198 the provenance of a screen with no printed spec of its own', () => {
  it('#198 names the path, the sorted query without the format, and the printed text', async () => {
    let printed: Printed | null = null;
    const answer: Answer = async (c) => {
      printed = screenPrinted(c, BODY);
      return c.text('ok');
    };
    await app(answer).request('/collections/tasks/views/v1?z=2&format=pdf&a=1&a=0');
    expect(printed).toEqual({
      reference: '/collections/tasks/views/v1',
      filters: ['a=0', 'a=1', 'z=2'],
      hashInput: { kind: 'text', text: BODY },
    });
  });
});
