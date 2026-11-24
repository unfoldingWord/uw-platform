import { describe, expect, it } from 'vitest';
import { pdfExportReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import type { Bindings, FilesBucket, PdfExportStart } from '../env.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { person } from '../testing/commands.ts';
import { memoryBucket } from '../testing/files.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

const fixture = createAccessFixture();
const MISSING = '00000000-0000-4000-8000-000000001498';

type Started = { readonly id: string; readonly params: PdfExportStart };

type World = {
  readonly db: Database;
  readonly bucket: FilesBucket;
  readonly started: Started[];
  readonly reader: string;
  readonly stranger: string;
  readonly root: string;
  readonly hidden: string;
};

async function world(db: Database): Promise<World> {
  const reader = await person(db, 'render-reader', 'editor', '00-09');
  const stranger = await person(db, 'render-stranger', 'editor', '30-39');
  const root = await fileKnowledge(db, reader.email, '01', { title: 'Field guide' });
  await fileKnowledge(db, reader.email, '01', { title: 'Day one', parentId: root.pageId });
  const hidden = await fileKnowledge(db, stranger.email, '31', { title: 'Elsewhere' });
  return {
    db,
    bucket: memoryBucket(),
    started: [],
    reader: reader.email,
    stranger: stranger.email,
    root: root.pageId,
    hidden: hidden.pageId,
  };
}

function envOf(made: World, unbound: readonly (keyof Bindings)[] = []): Bindings {
  const env: Bindings = {
    ...fixtureAccessEnv,
    FILES: made.bucket,
    BROWSER: fakeBrowser(),
    PDF_EXPORT: {
      create: async (options) => {
        made.started.push(options);
        return { id: options.id };
      },
    },
  };
  for (const name of unbound) delete env[name];
  return env;
}

async function render(made: World, email: string, target: object, env = envOf(made)) {
  const keys = await fixture;
  const token = await keys.signForMcp({ email });
  const app = createApp(postgresDeps(made.db, keys));
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  const client = await httpClient(app, headers, env);
  try {
    const { body } = await callTool(client, 'render_pdf', { target });
    return { body, text: JSON.stringify(body) };
  } finally {
    await client.close();
  }
}

async function download(made: World, email: string, path: string): Promise<Response> {
  const keys = await fixture;
  const token = await keys.sign({ email });
  const app = createApp(postgresDeps(made.db, keys));
  return app.request(path, { headers: { 'cf-access-jwt-assertion': token } }, envOf(made));
}

async function hidesLikeMissing(db: Database): Promise<void> {
  const made = await world(db);
  const hidden = await render(made, made.reader, { kind: 'page', pageId: made.hidden });
  const missing = await render(made, made.reader, { kind: 'page', pageId: MISSING });
  expect(missing.body).toMatchObject({ status: 'error', reason: 'page_not_found' });
  expect(hidden.text).toBe(missing.text.replace(MISSING, made.hidden));
  const binder = await render(made, made.reader, { kind: 'binder', pageIds: [made.hidden] });
  const none = await render(made, made.reader, { kind: 'binder', pageIds: [MISSING] });
  expect(binder.body).toMatchObject({ status: 'error', reason: 'binder_empty' });
  expect(binder.text).toBe(none.text);
}

async function readyForAReaderOnly(db: Database): Promise<void> {
  const made = await world(db);
  const { body } = await render(made, made.reader, { kind: 'page', pageId: made.root });
  expect(Object.keys(body).sort()).toEqual(['bytes', 'exportId', 'file', 'sha256', 'status']);
  const reply = pdfExportReplySchema.parse(body);
  expect(reply).toMatchObject({ status: 'ready', file: `/api/exports/${reply.exportId}/file` });
  expect(typeof reply.bytes).toBe('number');
  const read = await download(made, made.reader, reply.file);
  expect(read.status).toBe(200);
  expect(read.headers.get('content-type')).toBe('application/pdf');
  expect(read.headers.get('x-uw-sha256')).toBe(reply.sha256);
  expect(new Uint8Array(await read.arrayBuffer()).byteLength).toBe(reply.bytes);
  expect((await download(made, made.stranger, reply.file)).status).toBe(404);
}

async function binderQueues(db: Database): Promise<void> {
  const made = await world(db);
  const { body } = await render(made, made.reader, { kind: 'binder', rootPageId: made.root });
  const reply = pdfExportReplySchema.parse(body);
  expect(reply).toMatchObject({ status: 'queued', sha256: null, bytes: null });
  expect(made.started.map((start) => start.id)).toEqual([reply.exportId]);
  expect(made.started[0]?.params.exportId).toBe(reply.exportId);
  const read = await download(made, made.reader, reply.file);
  expect(read.status).toBe(409);
}

async function saysWhenUnwired(db: Database): Promise<void> {
  const made = await world(db);
  const page = { kind: 'page', pageId: made.root };
  const unbrowsed = await render(made, made.reader, page, envOf(made, ['BROWSER']));
  expect(unbrowsed.body).toMatchObject({ status: 'error', reason: 'not_wired' });
  const unfiled = await render(made, made.reader, page, envOf(made, ['FILES']));
  expect(unfiled.body).toMatchObject({ status: 'error', reason: 'not_wired' });
  const binder = { kind: 'binder', rootPageId: made.root };
  const unqueued = await render(made, made.reader, binder, envOf(made, ['PDF_EXPORT']));
  expect(unqueued.body).toMatchObject({ status: 'error', reason: 'not_wired' });
  expect(made.started).toEqual([]);
}

describe.skipIf(!testServer)('#198 render_pdf makes an export a person can download', () => {
  it('#198 answers a hidden page or binder exactly like a missing one', () =>
    withAppDatabase(hidesLikeMissing));
  it('#198 renders a page ready, with no bytes in the reply, for a reader and not a stranger', () =>
    withAppDatabase(readyForAReaderOnly));
  it('#198 queues a binder through the Workflow binding and answers it queued', () =>
    withAppDatabase(binderQueues));
  it('#198 refuses not_wired without a browser, a bucket or, for a binder, the Workflow', () =>
    withAppDatabase(saysWhenUnwired));
});
