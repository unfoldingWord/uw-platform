import { Hono, type Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { personPrincipal } from '@uw/core/principal';
import type { AppEnv } from '../deps.ts';
import type { Bindings } from '../env.ts';
import { failingBrowser, fakeBrowser } from '../testing/browser.ts';
import type { Printed } from './print-document.ts';
import { sha256Hex } from './provenance.ts';
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
  hashInput: { kind: 'hash', sha256: SHA },
};

async function exported(env: Bindings, printed: Printed = viewPrinted, signedIn = true) {
  const answer: Answer = (c) => pdfOfScreen(c, 'Open tasks: November', BODY, printed);
  const url = 'https://app.example.org/collections/tasks/views/v1?month=2026-11&format=pdf';
  return app(answer, signedIn).request(url, {}, env);
}

describe('#198 a screen answers ?format=pdf with a PDF of what it printed', () => {
  it('#198 streams the PDF as a download that is never cached, with its hash', async () => {
    const response = await exported({
      BROWSER: fakeBrowser(),
      APP_ORIGIN: 'https://app.example.org',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="open-tasks-november.pdf"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-uw-sha256')).toBe(SHA);
    expect(new TextDecoder().decode(await response.arrayBuffer()).startsWith('%PDF-')).toBe(true);
  });

  it('#198 prints the provenance of the request without the format, by the signed-in reader', async () => {
    const browser = fakeBrowser();
    await exported({ BROWSER: browser, APP_ORIGIN: 'https://app.example.org' });
    const [call] = browser.calls();
    const source = 'https://app.example.org/collections/tasks/views/v1?month=2026-11';
    expect(call?.html).toContain(source);
    expect(call?.html).not.toContain('format=pdf');
    expect(call?.html).toContain('reader@example.org');
    expect(call?.html).toContain('status is open');
    expect(call?.html).toContain('Two rows');
    expect(call?.pdfOptions.footerTemplate).toContain(
      `tasks/Open tasks · 2026-11-24 · sha256:${SHA.slice(0, 12)}`,
    );
  });

  it('#198 hashes the printed text when the screen names no hash of its own', async () => {
    const response = await exported(
      { BROWSER: fakeBrowser(), APP_ORIGIN: 'https://app.example.org' },
      { reference: '/dashboard', filters: [], hashInput: { kind: 'text', text: BODY } },
    );
    expect(response.headers.get('x-uw-sha256')).toBe(await sha256Hex(BODY));
  });
});

describe('#198 a screen that cannot print refuses with a closed-set reason', () => {
  it('#198 refuses not_wired when no browser is bound', async () => {
    const response = await exported({ APP_ORIGIN: 'https://app.example.org' });
    expect([response.status, await response.json()]).toEqual([
      404,
      { status: 'error', reason: 'not_wired' },
    ]);
  });

  it('#198 refuses pdf_render_failed when the browser fails', async () => {
    const response = await exported({
      BROWSER: failingBrowser(),
      APP_ORIGIN: 'https://app.example.org',
    });
    expect([response.status, await response.json()]).toEqual([
      502,
      { status: 'error', reason: 'pdf_render_failed' },
    ]);
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
