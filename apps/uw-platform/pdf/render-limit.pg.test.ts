import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { pdfExports } from '@uw/db/schema';
import { createApp } from '../app.tsx';
import type { Bindings, PdfExportStart } from '../env.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { fakeBrowser } from '../testing/browser.ts';
import { person } from '../testing/commands.ts';
import { memoryBucket } from '../testing/files.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';
import { getWithBindings } from '../testing/views.ts';
import { dailyRenderLimit } from './exports.ts';

const fixture = createAccessFixture();
const HOUR_MS = 3_600_000;
const LIMITED = [429, 'export_limit_reached'];

type World = {
  readonly db: Database;
  readonly browser: ReturnType<typeof fakeBrowser>;
  readonly started: { readonly id: string; readonly params: PdfExportStart }[];
  readonly env: Bindings;
  readonly personId: string;
  readonly email: string;
  readonly other: string;
  readonly pageId: string;
};

async function world(db: Database): Promise<World> {
  const reader = await person(db, 'limit-reader', 'editor', '00-09');
  const other = await person(db, 'limit-other', 'editor', '00-09');
  const page = await fileKnowledge(db, reader.email, '01', { title: 'Handbook' });
  const browser = fakeBrowser();
  const started: World['started'] = [];
  const env: Bindings = {
    ...fixtureAccessEnv,
    FILES: memoryBucket(),
    BROWSER: browser,
    PDF_EXPORT: {
      create: async (options) => {
        started.push(options);
        return { id: options.id };
      },
    },
  };
  const { id: personId, email } = reader;
  return { db, browser, started, env, personId, email, other: other.email, pageId: page.pageId };
}

async function seedRenders(made: World, count: number, at: Date): Promise<void> {
  const rows = Array.from({ length: count }, () => ({
    id: randomUUID(),
    kind: 'screen',
    status: 'ready',
    title: 'Earlier',
    reference: '/earlier',
    requestedBy: `human:${made.personId}`,
    personId: made.personId,
    areas: [],
    request: {},
    sourceSha256: 'c'.repeat(64),
    fileSha256: 'd'.repeat(64),
    bytes: 1,
    createdAt: at,
    finishedAt: at,
    expiresAt: new Date(at.getTime() + 7 * 24 * HOUR_MS),
  }));
  await made.db.insert(pdfExports).values(rows);
}

async function screenRows(made: World) {
  const recorded = and(eq(pdfExports.personId, made.personId), eq(pdfExports.title, 'Handbook'));
  return made.db.select().from(pdfExports).where(recorded);
}

function reasonOf(status: number, bytes: Uint8Array): readonly [number, unknown] {
  const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  return [status, body['reason']];
}

async function screenPdf(made: World, email: string) {
  return getWithBindings(made.db, email, `/pages/${made.pageId}?format=pdf`, made.env);
}

async function aScreenStopsAtTheLimit(db: Database): Promise<void> {
  const made = await world(db);
  await seedRenders(made, dailyRenderLimit - 1, new Date(Date.now() - HOUR_MS));
  expect((await screenPdf(made, made.email)).status).toBe(200);
  expect(await screenRows(made)).toEqual([
    expect.objectContaining({ kind: 'screen', status: 'ready', r2Key: null }),
  ]);
  const refused = await screenPdf(made, made.email);
  expect(reasonOf(refused.status, refused.bytes)).toEqual(LIMITED);
  expect(made.browser.calls()).toHaveLength(1);
  expect((await screenPdf(made, made.other)).status).toBe(200);
}

function postBinder(made: World, email: string) {
  return fixture.then(async (keys) => {
    const token = await keys.sign({ email });
    const headers = { 'cf-access-jwt-assertion': token, 'content-type': 'application/json' };
    const body = JSON.stringify({ kind: 'binder', title: 'Handbook', pageIds: [made.pageId] });
    const app = createApp(postgresDeps(made.db, keys));
    return app.request('/api/exports', { method: 'POST', headers, body }, made.env);
  });
}

async function aBinderPostStopsAtTheLimit(db: Database): Promise<void> {
  const made = await world(db);
  await seedRenders(made, dailyRenderLimit, new Date(Date.now() - 25 * HOUR_MS));
  expect((await postBinder(made, made.email)).status).toBe(202);
  await seedRenders(made, dailyRenderLimit - 1, new Date(Date.now() - HOUR_MS));
  const refused = await postBinder(made, made.email);
  expect(reasonOf(refused.status, new Uint8Array(await refused.arrayBuffer()))).toEqual(LIMITED);
  expect(made.started).toHaveLength(1);
}

async function rendered(made: World, target: object) {
  const keys = await fixture;
  const token = await keys.signForMcp({ email: made.email });
  const app = createApp(postgresDeps(made.db, keys));
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'laptop' };
  const client = await httpClient(app, headers, made.env);
  try {
    return (await callTool(client, 'render_pdf', { target })).body;
  } finally {
    await client.close();
  }
}

async function theVerbStopsAtTheLimit(db: Database): Promise<void> {
  const made = await world(db);
  await seedRenders(made, dailyRenderLimit - 1, new Date(Date.now() - HOUR_MS));
  const page = { kind: 'page', pageId: made.pageId };
  expect(await rendered(made, page)).toMatchObject({ status: 'ready' });
  const refusal = { status: 'error', reason: 'export_limit_reached' };
  expect(await rendered(made, page)).toMatchObject(refusal);
  expect(await rendered(made, { kind: 'binder', pageIds: [made.pageId] })).toMatchObject(refusal);
  expect(made.browser.calls()).toHaveLength(1);
  expect(made.started).toEqual([]);
}

describe.skipIf(!testServer)('#198 a person renders at most so many PDFs a day', () => {
  it('#198 a screen refuses export_limit_reached before the browser, and records each render', () =>
    withAppDatabase(aScreenStopsAtTheLimit));
  it('#198 a binder post refuses export_limit_reached, counting only the last day', () =>
    withAppDatabase(aBinderPostStopsAtTheLimit));
  it('#198 render_pdf refuses export_limit_reached for the person its agent acts for', () =>
    withAppDatabase(theVerbStopsAtTheLimit));
});
