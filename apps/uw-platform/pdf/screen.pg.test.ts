import { Hono, type Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@uw/core/log';
import { personPrincipal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { seedPerson } from '@uw/db/test-seed';
import type { AppEnv } from '../deps.ts';
import type { Bindings } from '../env.ts';
import { failingBrowser, fakeBrowser } from '../testing/browser.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { Printed } from './print-document.ts';
import { sha256Hex } from './provenance.ts';
import { pdfOfScreen } from './screen.ts';

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

const logged: Record<string, unknown>[] = [];
const logContext = { traceId: 'trace-screen', commit: 'test', route: 'GET', principal: null };
const logger = createLogger(logContext, (line) => {
  logged.push(JSON.parse(line) as Record<string, unknown>);
});

function app(db: Database, answer: Answer): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use(async (c, next) => {
    c.set('principal', reader);
    c.set('now', NOW);
    c.set('logger', logger);
    c.set('database', { db, ping: async () => undefined, release: async () => undefined });
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

function withReader(work: (db: Database) => Promise<void>): Promise<void> {
  return withAppDatabase(async (db) => {
    await seedPerson(db, { id: reader.personId ?? '', email: reader.email ?? '' });
    await work(db);
  });
}

async function exported(db: Database, env: Bindings, printed: Printed = viewPrinted) {
  const answer: Answer = (c) => pdfOfScreen(c, 'Open tasks: November', BODY, printed);
  const url = 'https://app.example.org/collections/tasks/views/v1?month=2026-11&format=pdf';
  return app(db, answer).request(url, {}, env);
}

const ORIGIN = 'https://app.example.org';

async function streamsTheDownload(db: Database): Promise<void> {
  const response = await exported(db, { BROWSER: fakeBrowser(), APP_ORIGIN: ORIGIN });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(response.headers.get('content-disposition')).toBe(
    'attachment; filename="open-tasks-november.pdf"',
  );
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-uw-source-sha256')).toBe(SHA);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(response.headers.get('x-uw-file-sha256')).toBe(await sha256Hex(bytes));
  expect(new TextDecoder().decode(bytes).startsWith('%PDF-')).toBe(true);
}

async function printsTheProvenance(db: Database): Promise<void> {
  const browser = fakeBrowser();
  await exported(db, { BROWSER: browser, APP_ORIGIN: ORIGIN });
  const [call] = browser.calls();
  expect(call?.html).toContain(`${ORIGIN}/collections/tasks/views/v1?month=2026-11`);
  expect(call?.html).not.toContain('format=pdf');
  expect(call?.html).toContain('reader@example.org');
  expect(call?.html).toContain('status is open');
  expect(call?.html).toContain('Two rows');
  expect(call?.pdfOptions.footerTemplate).toContain(
    `tasks/Open tasks · 2026-11-24 · source sha256:${SHA.slice(0, 12)}`,
  );
}

async function hashesThePrintedText(db: Database): Promise<void> {
  const textual: Printed = {
    reference: '/dashboard',
    filters: [],
    hashInput: { kind: 'text', text: BODY },
  };
  const response = await exported(db, { BROWSER: fakeBrowser(), APP_ORIGIN: ORIGIN }, textual);
  expect(response.headers.get('x-uw-source-sha256')).toBe(await sha256Hex(BODY));
}

async function refusesAFailedRender(db: Database): Promise<void> {
  logged.length = 0;
  const response = await exported(db, { BROWSER: failingBrowser(), APP_ORIGIN: ORIGIN });
  expect([response.status, await response.json()]).toEqual([
    502,
    { status: 'error', reason: 'pdf_render_failed' },
  ]);
  const failures = logged.filter((line) => line.message === 'pdf render failed');
  expect(failures).toEqual([
    expect.objectContaining({
      outcome: 'pdf_render_failed',
      status: 500,
      trace_id: 'trace-screen',
    }),
  ]);
  expect(JSON.stringify(logged)).not.toContain('Two rows');
}

describe.skipIf(!testServer)(
  '#198 a screen answers ?format=pdf with a PDF of what it printed',
  () => {
    it('#198 streams the PDF as a download that is never cached, with its hash', () =>
      withReader(streamsTheDownload));
    it('#198 prints the provenance of the request without the format, by the signed-in reader', () =>
      withReader(printsTheProvenance));
    it('#198 hashes the printed text when the screen names no hash of its own', () =>
      withReader(hashesThePrintedText));
    it('#198 refuses pdf_render_failed when the browser fails, and logs why without the page', () =>
      withReader(refusesAFailedRender));
  },
);
