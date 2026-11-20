import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileReplySchema, pageFilesReplySchema, pageReadReplySchema } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { createApp } from '../app.tsx';
import type { FilesBucket } from '../env.ts';
import { seedGrant } from '@uw/db/test-seed';
import { memoryBucket } from '../testing/files.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

type World = {
  readonly db: Database;
  readonly bucket: FilesBucket | null;
  readonly editor: string;
  readonly viewer: string;
  readonly stranger: string;
  readonly pageId: string;
};

type Sent = { readonly status: number; readonly raw: Response };

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const fixture = createAccessFixture();

async function world(db: Database, bucket: FilesBucket | null = memoryBucket()): Promise<World> {
  const editor = await person(db, 'file-editor', 'editor', '00-09');
  const viewer = await person(db, 'file-viewer', 'viewer', '00-09');
  const stranger = await person(db, 'file-stranger', 'editor', '20-29');
  const page = await fileKnowledge(db, editor.email, '01', { title: 'With a picture' });
  return {
    db,
    bucket,
    editor: editor.email,
    viewer: viewer.email,
    stranger: stranger.email,
    pageId: page.pageId,
  };
}

async function send(
  made: World,
  email: string,
  path: string,
  init: RequestInit = {},
): Promise<Sent> {
  const keys = await fixture;
  const token = await keys.sign({ email });
  const env = made.bucket === null ? fixtureAccessEnv : { ...fixtureAccessEnv, FILES: made.bucket };
  const raw = await createApp(postgresDeps(made.db, keys)).request(
    path,
    { ...init, headers: { ...init.headers, 'cf-access-jwt-assertion': token } },
    env,
  );
  return { status: raw.status, raw };
}

type Upload = {
  readonly type?: string;
  readonly body?: Uint8Array<ArrayBuffer>;
  readonly name?: string;
};

function put(made: World, email: string, fileId: string, upload: Upload = {}): Promise<Sent> {
  const name = encodeURIComponent(upload.name ?? 'index.png');
  return send(made, email, `/api/files/${fileId}?page=${made.pageId}&name=${name}`, {
    method: 'PUT',
    headers: { 'content-type': upload.type ?? 'image/png' },
    body: upload.body ?? PNG,
  });
}

async function reasonOf(sent: Sent): Promise<unknown> {
  const body = (await sent.raw.json()) as Record<string, unknown>;
  return body['reason'];
}

async function storesAndServes(db: Database): Promise<void> {
  const made = await world(db);
  const fileId = randomUUID();
  const stored = await put(made, made.editor, fileId);
  expect(stored.status).toBe(200);
  const { file } = fileReplySchema.parse(await stored.raw.json());
  expect(file).toMatchObject({
    id: fileId,
    pageId: made.pageId,
    jdArea: '00-09',
    name: 'index.png',
    contentType: 'image/png',
    size: PNG.byteLength,
    url: `/api/files/${fileId}`,
  });
  const read = await send(made, made.viewer, `/api/files/${fileId}`);
  expect(read.status).toBe(200);
  expect([...new Uint8Array(await read.raw.arrayBuffer())]).toEqual([...PNG]);
  expect(read.raw.headers.get('content-type')).toBe('image/png');
  expect(read.raw.headers.get('x-content-type-options')).toBe('nosniff');
  expect(read.raw.headers.get('content-security-policy')).toContain("default-src 'none'");
  const listed = await send(made, made.viewer, `/api/pages/${made.pageId}/files`);
  expect(pageFilesReplySchema.parse(await listed.raw.json()).files.map((one) => one.id)).toEqual([
    fileId,
  ]);
}

async function onlyWhereAllowed(db: Database): Promise<void> {
  const made = await world(db);
  const fileId = randomUUID();
  expect(await reasonOf(await put(made, made.viewer, fileId))).toBe('not_permitted');
  expect(await reasonOf(await put(made, made.stranger, fileId))).toBe('page_not_found');
  expect((await put(made, made.editor, fileId)).status).toBe(200);
  const hidden = await send(made, made.stranger, `/api/files/${fileId}`);
  expect(hidden.status).toBe(404);
  expect(await reasonOf(hidden)).toBe('file_not_found');
  const missing = await send(made, made.editor, `/api/files/${randomUUID()}`);
  expect(await reasonOf(missing)).toBe('file_not_found');
}

async function refusesWhatItShouldNotHold(db: Database): Promise<void> {
  const made = await world(db);
  const html = await put(made, made.editor, randomUUID(), { type: 'text/html', name: 'x.html' });
  expect(await reasonOf(html)).toBe('file_type_not_allowed');
  const svg = await put(made, made.editor, randomUUID(), { type: 'image/svg+xml' });
  expect(await reasonOf(svg)).toBe('file_type_not_allowed');
  const empty = await put(made, made.editor, randomUUID(), { body: new Uint8Array() });
  expect(await reasonOf(empty)).toBe('malformed_command');
  const huge = await put(made, made.editor, randomUUID(), {
    body: new Uint8Array(20 * 1024 * 1024 + 1),
  });
  expect(await reasonOf(huge)).toBe('file_too_large');
  const crossSite = await send(
    made,
    made.editor,
    `/api/files/${randomUUID()}?page=${made.pageId}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'image/png', 'sec-fetch-site': 'cross-site' },
      body: PNG,
    },
  );
  expect(await reasonOf(crossSite)).toBe('malformed_command');
}

async function sentTwiceAndNotWired(db: Database): Promise<void> {
  const made = await world(db);
  const fileId = randomUUID();
  const first = fileReplySchema.parse(await (await put(made, made.editor, fileId)).raw.json());
  const again = fileReplySchema.parse(await (await put(made, made.editor, fileId)).raw.json());
  expect(again).toEqual(first);
  const unwired = { ...made, bucket: null };
  expect(await reasonOf(await put(unwired, made.editor, randomUUID()))).toBe('not_wired');
  expect(await reasonOf(await send(unwired, made.editor, `/api/files/${fileId}`))).toBe(
    'not_wired',
  );
}

async function showsInThePage(db: Database): Promise<void> {
  const made = await world(db);
  const fileId = randomUUID();
  await put(made, made.editor, fileId);
  const page = await fileKnowledge(db, made.editor, '01', {
    title: 'Illustrated',
    bodyMd: `![The index](/api/files/${fileId})`,
  });
  const read = await send(made, made.viewer, `/api/pages/${page.pageId}?format=html`);
  const html = pageReadReplySchema.parse(await read.raw.json()).html ?? '';
  expect(html).toContain(`<img src="/api/files/${fileId}" alt="The index">`);
}

async function followsThePageWhenItMoves(db: Database): Promise<void> {
  const mover = await person(db, 'file-mover', 'editor', '00-09');
  await seedGrant(db, {
    id: randomUUID(),
    personId: mover.id,
    role: 'editor',
    scopeKind: 'jd_area',
    scopeArea: '20-29',
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  const made = await world(db);
  const page = await fileKnowledge(db, mover.email, '01', { title: 'Moving' });
  const moved = { ...made, editor: mover.email, pageId: page.pageId };
  const fileId = randomUUID();
  expect((await put(moved, mover.email, fileId)).status).toBe(200);
  expect((await send(moved, made.viewer, `/api/files/${fileId}`)).status).toBe(200);
  const sent = await send(moved, mover.email, '/api/pages/commands/move_page', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      command: 'move_page',
      requestId: randomUUID(),
      pageId: page.pageId,
      expectedVersion: 1,
      category: '21',
      parentId: null,
    }),
  });
  expect(sent.status).toBe(200);
  expect((await send(moved, made.viewer, `/api/files/${fileId}`)).status).toBe(404);
  expect((await send(moved, made.stranger, `/api/files/${fileId}`)).status).toBe(200);
  const listed = await send(moved, made.stranger, `/api/pages/${page.pageId}/files`);
  const { files } = pageFilesReplySchema.parse(await listed.raw.json());
  expect(files.map((file) => file.jdArea)).toEqual(['20-29']);
}

describe.skipIf(!testServer)('#175 a page can hold pictures and files', () => {
  it('serves a file to the readers of the area its page is in now, after a move', () =>
    withAppDatabase(followsThePageWhenItMoves));

  it('stores an upload against a page and serves it back, bytes and type intact', () =>
    withAppDatabase(storesAndServes));

  it('takes an upload only from a person who may write the page, and serves only to its readers', () =>
    withAppDatabase(onlyWhereAllowed));

  it('refuses a type that could run, an empty body, an oversized file and another site', () =>
    withAppDatabase(refusesWhatItShouldNotHold));

  it('answers a repeated upload with the first result, and says so when no bucket is bound', () =>
    withAppDatabase(sentTwiceAndNotWired));

  it('shows an uploaded picture in the rendered page', () => withAppDatabase(showsInThePage));
});
