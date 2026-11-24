import { describe, expect, it } from 'vitest';
import { pdfExportReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import type { Bindings, FilesBucket, PdfExportBinding, PdfExportStart } from '../env.ts';
import { bucketFiles } from '../pages/file-store.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { person } from '../testing/commands.ts';
import { memoryBucket } from '../testing/files.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { screenProblems } from '../testing/screen-checks.ts';
import { runPdfExport } from './export-run.ts';
import { recordingPdf } from './renderer.ts';

const fixture = createAccessFixture();
const FORM = 'application/x-www-form-urlencoded';

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
  const reader = await person(db, 'exports-reader', 'editor', '00-09');
  const stranger = await person(db, 'exports-stranger', 'editor', '30-39');
  const root = await fileKnowledge(db, reader.email, '01', { title: 'Onboarding' });
  await fileKnowledge(db, reader.email, '01', { title: 'Week one', parentId: root.pageId });
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

function recordingStarts(started: Started[]): PdfExportBinding {
  return {
    create: async (options) => {
      started.push(options);
      return { id: options.id };
    },
  };
}

function envOf(made: World, unbound: readonly (keyof Bindings)[] = []): Bindings {
  const env: Bindings = {
    ...fixtureAccessEnv,
    FILES: made.bucket,
    BROWSER: fakeBrowser(),
    PDF_EXPORT: recordingStarts(made.started),
  };
  for (const name of unbound) delete env[name];
  return env;
}

async function send(
  made: World,
  email: string,
  path: string,
  init: RequestInit = {},
  env?: Bindings,
) {
  const keys = await fixture;
  const token = await keys.sign({ email });
  const headers = { 'cf-access-jwt-assertion': token, ...(init.headers as Record<string, string>) };
  return createApp(postgresDeps(made.db, keys)).request(
    path,
    { ...init, headers },
    env ?? envOf(made),
  );
}

function postJson(made: World, email: string, body: unknown, env?: Bindings) {
  const init = {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  };
  return send(made, email, '/api/exports', init, env);
}

async function reasonOf(response: Response): Promise<readonly [number, unknown]> {
  const body = (await response.json()) as Record<string, unknown>;
  return [response.status, body['reason']];
}

async function queuesABinder(db: Database): Promise<void> {
  const made = await world(db);
  const sent = await postJson(made, made.reader, { kind: 'binder', rootPageId: made.root });
  expect(sent.status).toBe(202);
  const reply = pdfExportReplySchema.parse(await sent.json());
  expect(reply).toEqual({
    exportId: reply.exportId,
    status: 'queued',
    file: `/api/exports/${reply.exportId}/file`,
    sha256: null,
    bytes: null,
  });
  expect(made.started).toEqual([
    { id: reply.exportId, params: { exportId: reply.exportId, traceId: expect.any(String) } },
  ]);
  const read = await send(made, made.reader, `/api/exports/${reply.exportId}`);
  expect(pdfExportReplySchema.parse(await read.json())).toEqual(reply);
  const early = await send(made, made.reader, reply.file);
  expect(await reasonOf(early)).toEqual([409, 'export_not_ready']);
}

async function formPostRedirectsToTheScreen(db: Database): Promise<void> {
  const made = await world(db);
  const body = new URLSearchParams({ kind: 'binder', rootPageId: made.root });
  const headers = { 'content-type': FORM, origin: 'http://localhost' };
  const sent = await send(made, made.reader, '/api/exports', { method: 'POST', body, headers });
  expect(sent.status).toBe(303);
  const [started] = made.started;
  expect(sent.headers.get('location')).toBe(`/exports/${started?.id ?? 'none'}`);
  const foreign = { 'content-type': FORM, origin: 'https://elsewhere.example' };
  const refused = await send(made, made.reader, '/api/exports', {
    method: 'POST',
    body,
    headers: foreign,
  });
  expect(refused.status).toBe(403);
  expect(made.started).toHaveLength(1);
}

async function refusesWhatItCannotQueue(db: Database): Promise<void> {
  const made = await world(db);
  const byRoot = { kind: 'binder', rootPageId: made.root };
  for (const name of ['PDF_EXPORT', 'FILES', 'BROWSER'] as const) {
    expect(await reasonOf(await postJson(made, made.reader, byRoot, envOf(made, [name])))).toEqual([
      404,
      'not_wired',
    ]);
  }
  const unreadable = { kind: 'binder', rootPageId: made.hidden };
  expect(await reasonOf(await postJson(made, made.reader, unreadable))).toEqual([
    422,
    'binder_empty',
  ]);
  expect(await reasonOf(await postJson(made, made.reader, { kind: 'binder' }))).toEqual([
    400,
    'malformed_command',
  ]);
  expect(made.started).toEqual([]);
}

async function servesTheFileToReadersOnly(db: Database): Promise<void> {
  const made = await world(db);
  const sent = await postJson(made, made.reader, { kind: 'binder', rootPageId: made.root });
  const reply = pdfExportReplySchema.parse(await sent.json());
  const deps = {
    db,
    files: bucketFiles(made.bucket),
    renderer: recordingPdf(),
    origin: 'http://localhost',
    commit: 'test',
    now: () => new Date(),
  };
  const [started] = made.started;
  if (started === undefined) throw new Error('not started');
  expect(await runPdfExport(deps, started.params)).toBe('ready');
  const file = await send(made, made.reader, reply.file);
  expect(file.status).toBe(200);
  expect(file.headers.get('content-type')).toBe('application/pdf');
  expect(file.headers.get('content-disposition')).toBe('attachment; filename="onboarding.pdf"');
  expect(new TextDecoder().decode(await file.arrayBuffer())).toMatch(/^%PDF-1\.7/);
  expect(await reasonOf(await send(made, made.stranger, reply.file))).toEqual([
    404,
    'export_not_found',
  ]);
  const strangerRead = await send(made, made.stranger, `/api/exports/${reply.exportId}`);
  expect(await reasonOf(strangerRead)).toEqual([404, 'export_not_found']);
  const unwired = await send(made, made.reader, reply.file, {}, envOf(made, ['FILES']));
  expect(await reasonOf(unwired)).toEqual([404, 'not_wired']);
}

async function screenShowsTheExport(db: Database): Promise<void> {
  const made = await world(db);
  const sent = await postJson(made, made.reader, { kind: 'binder', rootPageId: made.root });
  const reply = pdfExportReplySchema.parse(await sent.json());
  const queued = await send(made, made.reader, `/exports/${reply.exportId}`);
  expect(queued.status).toBe(200);
  const waiting = await queued.text();
  expect(await screenProblems(waiting)).toEqual([]);
  expect(waiting).toContain('data-refresh-every');
  expect(waiting).toContain('Onboarding');
  expect(waiting).not.toContain(reply.file);
  const [started] = made.started;
  if (started === undefined) throw new Error('not started');
  const files = bucketFiles(made.bucket);
  const deps = {
    db,
    files,
    renderer: recordingPdf(),
    origin: '',
    commit: 't',
    now: () => new Date(),
  };
  await runPdfExport(deps, started.params);
  const ready = await (await send(made, made.reader, `/exports/${reply.exportId}`)).text();
  expect(await screenProblems(ready)).toEqual([]);
  expect(ready).toContain(`href="${reply.file}"`);
  expect(ready).not.toContain('data-refresh-every');
  const stranger = await send(made, made.stranger, `/exports/${reply.exportId}`);
  expect(stranger.status).toBe(404);
}

async function screenShowsAFailureInPlace(db: Database): Promise<void> {
  const made = await world(db);
  const sent = await postJson(made, made.reader, { kind: 'binder', rootPageId: made.root });
  const reply = pdfExportReplySchema.parse(await sent.json());
  const [started] = made.started;
  if (started === undefined) throw new Error('not started');
  const files = bucketFiles(made.bucket);
  const deps = { db, files, renderer: null, origin: '', commit: 't', now: () => new Date() };
  await runPdfExport(deps, started.params);
  const failed = await (await send(made, made.reader, `/exports/${reply.exportId}`)).text();
  expect(failed).toContain('Not wired');
  expect(failed).not.toContain(`href="${reply.file}"`);
}

describe.skipIf(!testServer)('#198 the PDF export routes', () => {
  it('#198 queues a binder through the Workflow binding and answers it queued, not ready', () =>
    withAppDatabase(queuesABinder));
  it('#198 a form post queues the binder and redirects to the export screen, same origin only', () =>
    withAppDatabase(formPostRedirectsToTheScreen));
  it('#198 refuses not_wired, binder_empty and a malformed request without starting a run', () =>
    withAppDatabase(refusesWhatItCannotQueue));
  it('#198 serves the ready PDF from the bucket to a reader and refuses a stranger', () =>
    withAppDatabase(servesTheFileToReadersOnly));
  it('#198 the export screen refreshes while queued and offers the download when ready', () =>
    withAppDatabase(screenShowsTheExport));
  it('#198 the export screen shows a failed export with its closed-set reason in place', () =>
    withAppDatabase(screenShowsAFailureInPlace));
});
