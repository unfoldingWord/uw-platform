import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pdfExportReplySchema, viewSettingsSchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import { saveView } from '../collections/view-commands.ts';
import type { Bindings, PdfExportStart } from '../env.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { testPortfolio, testProgram } from '../testing/collection-definitions.ts';
import { accepted, defined, personWith, requestOf, rowIn } from '../testing/collections.ts';
import { memoryBucket } from '../testing/files.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { runPdfExport } from './export-run.ts';
import { recordingPdf } from './renderer.ts';

const fixture = createAccessFixture();
const TITLE = 'Quarterly field report';
const HTML = { headers: { accept: 'text/html' } };

type World = {
  readonly db: Database;
  readonly env: Bindings;
  readonly started: { readonly id: string; readonly params: PdfExportStart }[];
  readonly owner: string;
  readonly holder: string;
  readonly pageId: string;
};

async function savedView(db: Database): Promise<string> {
  const admin = await personWith(db, 'access-admin', [
    { role: 'admin', area: '60-69' },
    { role: 'viewer', area: '00-09' },
  ]);
  await defined(db, admin, testPortfolio);
  await defined(db, admin, testProgram);
  await rowIn(db, admin, { collection: 'tprogram', jdArea: '60-69', title: 'Gateway languages' });
  const viewId = randomUUID();
  const settings = viewSettingsSchema.parse({ name: 'Programs', layout: 'list', scope: 'shared' });
  const command = {
    command: 'save_view' as const,
    requestId: randomUUID(),
    collection: 'tprogram',
  };
  accepted(await saveView(db, { ...command, viewId, settings }, requestOf(admin)));
  return viewId;
}

async function embeddingPage(db: Database, viewId: string): Promise<string> {
  const pageId = randomUUID();
  await seedPage(db, {
    id: pageId,
    type: 'knowledge',
    status: 'active',
    jdArea: '00-09',
    slug: 'field-report',
    title: 'Field report',
    bodyMd: `Our programs:\n\n![Programs](/collections/tprogram/views/${viewId})\n`,
    frontmatter: { jd_category: '01' },
  });
  return pageId;
}

async function world(db: Database): Promise<World> {
  const pageId = await embeddingPage(db, await savedView(db));
  const owner = await personWith(db, 'access-owner', [
    { role: 'viewer', area: '60-69' },
    { role: 'editor', area: '00-09' },
  ]);
  const holder = await personWith(db, 'access-holder', [{ role: 'viewer', area: '00-09' }]);
  const started: World['started'] = [];
  const env: Bindings = {
    ...fixtureAccessEnv,
    FILES: memoryBucket(),
    BROWSER: fakeBrowser(),
    PDF_EXPORT: {
      create: async (options) => {
        started.push(options);
        return { id: options.id };
      },
    },
  };
  return { db, env, started, owner: owner.email ?? '', holder: holder.email ?? '', pageId };
}

async function send(made: World, email: string, path: string, init: RequestInit = {}) {
  const keys = await fixture;
  const token = await keys.sign({ email });
  const headers = { 'cf-access-jwt-assertion': token, ...(init.headers as Record<string, string>) };
  const app = createApp(postgresDeps(made.db, keys));
  return app.request(path, { ...init, headers }, made.env);
}

async function exportedByTheOwner(made: World, renderer = recordingPdf()) {
  const body = JSON.stringify({ kind: 'binder', title: TITLE, pageIds: [made.pageId] });
  const headers = { 'content-type': 'application/json' };
  const sent = await send(made, made.owner, '/api/exports', { method: 'POST', body, headers });
  const reply = pdfExportReplySchema.parse(await sent.json());
  const [started] = made.started;
  if (started === undefined || made.env.FILES === undefined) throw new Error('not started');
  const files = bucketFiles(made.env.FILES);
  const deps = { db: made.db, files, renderer, origin: '', commit: 't', now: () => new Date() };
  expect(await runPdfExport(deps, started.params)).toBe('ready');
  return reply;
}

async function reasonOf(response: Response): Promise<readonly [number, unknown]> {
  const body = (await response.json()) as Record<string, unknown>;
  return [response.status, body['reason']];
}

async function onlyTheOwnerHoldsTheExport(db: Database): Promise<void> {
  const made = await world(db);
  const renderer = recordingPdf();
  const reply = await exportedByTheOwner(made, renderer);
  expect(renderer.jobs()[0]?.html).toContain('Gateway languages');
  const file = await send(made, made.owner, reply.file);
  expect(file.status).toBe(200);
  expect(new TextDecoder().decode(await file.arrayBuffer())).toMatch(/^%PDF-1\.7/);
  const notFound = [404, 'export_not_found'];
  expect(await reasonOf(await send(made, made.holder, reply.file))).toEqual(notFound);
  const status = await send(made, made.holder, `/api/exports/${reply.exportId}`);
  expect(await reasonOf(status)).toEqual(notFound);
  const screen = await send(made, made.holder, `/exports/${reply.exportId}`, HTML);
  expect(screen.status).toBe(404);
  const shown = await screen.text();
  expect(shown).toContain('You cannot open that page');
  expect(shown).not.toContain(TITLE);
  const own = await send(made, made.owner, `/exports/${reply.exportId}`, HTML);
  expect([own.status, (await own.text()).includes(TITLE)]).toEqual([200, true]);
}

async function rendered(made: World, email: string, target: object) {
  const keys = await fixture;
  const token = await keys.signForMcp({ email });
  const app = createApp(postgresDeps(made.db, keys));
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  const client = await httpClient(app, headers, made.env);
  try {
    return pdfExportReplySchema.parse((await callTool(client, 'render_pdf', { target })).body);
  } finally {
    await client.close();
  }
}

async function anAgentExportBelongsToItsPerson(db: Database): Promise<void> {
  const made = await world(db);
  const reply = await rendered(made, made.owner, { kind: 'page', pageId: made.pageId });
  expect(reply.status).toBe('ready');
  expect((await send(made, made.owner, reply.file)).status).toBe(200);
  const notFound = [404, 'export_not_found'];
  expect(await reasonOf(await send(made, made.holder, reply.file))).toEqual(notFound);
  const status = await send(made, made.holder, `/api/exports/${reply.exportId}`);
  expect(await reasonOf(status)).toEqual(notFound);
}

describe.skipIf(!testServer)(
  '#198 a stored export is held only by the person it was made for',
  () => {
    it('#198 a link holder who reads the page but not its embedded view finds nothing there', () =>
      withAppDatabase(onlyTheOwnerHoldsTheExport));
    it('#198 an agent export is downloadable by the person the agent acts for and no one else', () =>
      withAppDatabase(anAgentExportBelongsToItsPerson));
  },
);
