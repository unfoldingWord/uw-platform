import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fileSchema, MAX_AGENT_FILE_BYTES } from '@uw/contracts';
import type { Database } from '@uw/db/client';
import { seedGrant } from '@uw/db/test-seed';
import { createApp } from '../app.tsx';
import type { FilesBucket } from '../env.ts';
import { createAccessFixture, fixtureAccessEnv } from '../testing/access-keys.ts';
import { person } from '../testing/commands.ts';
import { memoryBucket } from '../testing/files.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { callTool, httpClient } from '../testing/mcp.ts';
import { postgresDeps, testServer, withAppDatabase } from '../testing/postgres.ts';

type World = {
  readonly db: Database;
  readonly bucket: FilesBucket | null;
  readonly editor: string;
  readonly viewer: string;
  readonly stranger: string;
  readonly pageId: string;
};

type Attach = {
  readonly fileId?: string;
  readonly contentType?: string;
  readonly bytes?: Uint8Array;
};

const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const fixture = createAccessFixture();

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function world(db: Database, bucket: FilesBucket | null = memoryBucket()): Promise<World> {
  const editor = await person(db, 'attach-editor', 'editor', '00-09');
  const viewer = await person(db, 'attach-viewer', 'editor', '30-39');
  await seedGrant(db, {
    id: randomUUID(),
    personId: viewer.id,
    role: 'viewer',
    scopeKind: 'jd_area',
    scopeArea: '00-09',
    grantedAt: new Date(Date.now() - 60_000),
    expiresAt: null,
  });
  const stranger = await person(db, 'attach-stranger', 'editor', '20-29');
  const page = await fileKnowledge(db, editor.email, '01', { title: 'Imported from Notion' });
  return {
    db,
    bucket,
    editor: editor.email,
    viewer: viewer.email,
    stranger: stranger.email,
    pageId: page.pageId,
  };
}

async function attach(made: World, email: string, upload: Attach = {}) {
  const keys = await fixture;
  const token = await keys.signForMcp({ email });
  const env = made.bucket === null ? fixtureAccessEnv : { ...fixtureAccessEnv, FILES: made.bucket };
  const app = createApp(postgresDeps(made.db, keys));
  const headers = { 'cf-access-jwt-assertion': token, 'x-uw-device': 'importer' };
  const client = await httpClient(app, headers, env);
  try {
    const { body } = await callTool(client, 'attach_file', {
      fileId: upload.fileId ?? randomUUID(),
      pageId: made.pageId,
      name: 'zoom-settings.png',
      contentType: upload.contentType ?? 'image/png',
      contentBase64: base64Of(upload.bytes ?? PNG),
    });
    return body;
  } finally {
    await client.close();
  }
}

async function readBack(made: World, email: string, url: string): Promise<Response> {
  const keys = await fixture;
  const token = await keys.sign({ email });
  const env = { ...fixtureAccessEnv, FILES: made.bucket ?? memoryBucket() };
  const app = createApp(postgresDeps(made.db, keys));
  return app.request(url, { headers: { 'cf-access-jwt-assertion': token } }, env);
}

async function storesWhatAPersonReads(db: Database): Promise<void> {
  const made = await world(db);
  const fileId = randomUUID();
  const body = await attach(made, made.editor, { fileId });
  const file = fileSchema.parse(body['file']);
  expect(file).toMatchObject({
    id: fileId,
    pageId: made.pageId,
    jdArea: '00-09',
    contentType: 'image/png',
    size: PNG.byteLength,
    url: `/api/files/${fileId}`,
  });
  expect(file.uploadedBy).toMatch(/^agent:.+\/importer$/);
  const read = await readBack(made, made.viewer, file.url);
  expect(read.status).toBe(200);
  expect([...new Uint8Array(await read.arrayBuffer())]).toEqual([...PNG]);
}

async function onlyWhereTheAgentMayEdit(db: Database): Promise<void> {
  const made = await world(db);
  expect((await attach(made, made.viewer))['reason']).toBe('not_permitted');
  expect((await attach(made, made.stranger))['reason']).toBe('page_not_found');
}

async function sentTwiceKeepsTheFirst(db: Database): Promise<void> {
  const made = await world(db);
  const fileId = randomUUID();
  const first = await attach(made, made.editor, { fileId });
  const again = await attach(made, made.editor, { fileId, bytes: Uint8Array.from([1, 2, 3]) });
  expect(again).toEqual(first);
}

async function refusesWhatItShouldNotHold(db: Database): Promise<void> {
  const made = await world(db);
  const html = await attach(made, made.editor, { contentType: 'text/html' });
  expect(html['reason']).toBe('malformed_command');
  const huge = await attach(made, made.editor, { bytes: new Uint8Array(MAX_AGENT_FILE_BYTES + 3) });
  expect(huge['reason']).toBe('malformed_command');
  const unwired = await attach({ ...made, bucket: null }, made.editor);
  expect(unwired['reason']).toBe('not_wired');
}

describe.skipIf(!testServer)('attach_file stores a picture on a page an agent may edit', () => {
  it('stores the bytes on the page and a reader of the area gets them back', () =>
    withAppDatabase(storesWhatAPersonReads));

  it('refuses a viewer and hides a page in an area the agent cannot read', () =>
    withAppDatabase(onlyWhereTheAgentMayEdit));

  it('answers a repeated file id with the first file, so a rerun changes nothing', () =>
    withAppDatabase(sentTwiceKeepsTheFirst));

  it('refuses a type outside the list, a file over 5 MiB, and says when no bucket is bound', () =>
    withAppDatabase(refusesWhatItShouldNotHold));
});
