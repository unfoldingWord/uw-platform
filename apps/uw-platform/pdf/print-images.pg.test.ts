import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { personPrincipal, type Principal } from '@uw/core/principal';
import type { Database } from '@uw/db/client';
import { memoryFiles, type FileStore } from '../pages/file-store.ts';
import { storeFile } from '../pages/files.ts';
import { person } from '../testing/commands.ts';
import { fileKnowledge } from '../testing/knowledge.ts';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import { base64Of, fileImages } from './print-images.ts';

const ORIGIN = 'https://app.example.org';
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const VIDEO = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);

function reader(role: 'editor' | 'viewer', area: string): Principal {
  return personPrincipal({
    personId: randomUUID(),
    email: `${role}-${area}@example.org`,
    grants: [
      { grantId: randomUUID(), role, scopeKind: 'jd_area', scopeArea: area, expiresAt: null },
    ],
    interactive: true,
  });
}

type Shelf = { readonly files: FileStore; readonly image: string; readonly video: string };

async function shelf(db: Database, at: Date): Promise<Shelf> {
  const editor = await person(db, 'print-editor', 'editor', '00-09');
  const page = await fileKnowledge(db, editor.email, '01', { title: 'With a picture' });
  const files = memoryFiles();
  const uploader = { actor: reader('editor', '00-09'), at };
  const image = randomUUID();
  const video = randomUUID();
  const common = { pageId: page.pageId, name: 'door' };
  const stored = [
    await storeFile(db, files, uploader, {
      ...common,
      fileId: image,
      contentType: 'image/png',
      bytes: PNG,
    }),
    await storeFile(db, files, uploader, {
      ...common,
      fileId: video,
      contentType: 'video/mp4',
      bytes: VIDEO,
    }),
  ];
  expect(stored.map((result) => result.ok)).toEqual([true, true]);
  return { files, image, video };
}

async function inlinesOnlyReadableImages(db: Database): Promise<void> {
  const at = new Date();
  const made = await shelf(db, at);
  const viewer = fileImages(db, made.files, { actor: reader('viewer', '00-09'), at }, ORIGIN);
  const stranger = fileImages(db, made.files, { actor: reader('viewer', '20-29'), at }, ORIGIN);
  const data = `data:image/png;base64,${base64Of(PNG)}`;
  expect(await viewer(`/api/files/${made.image}`)).toBe(data);
  expect(await viewer(`${ORIGIN}/api/files/${made.image}`)).toBe(data);
  expect(await stranger(`/api/files/${made.image}`)).toBeNull();
  expect(await viewer(`/api/files/${made.video}`)).toBeNull();
  expect(await viewer(`/api/files/${randomUUID()}`)).toBeNull();
  expect(await viewer('https://elsewhere.example.com/picture.png')).toBeNull();
}

describe.skipIf(!testServer)(
  '#198 a printed page inlines only the images its reader may read',
  () => {
    it('#198 inlines a readable image as a data URI and leaves out unreadable, missing, video and outside images', () =>
      withAppDatabase(inlinesOnlyReadableImages));
  },
);

describe('#198 the image bytes are written as base64', () => {
  it('#198 matches the platform base64 for small and large files', () => {
    const large = Uint8Array.from({ length: 100_000 }, (_, at) => at % 256);
    expect(base64Of(PNG)).toBe(Buffer.from(PNG).toString('base64'));
    expect(base64Of(large)).toBe(Buffer.from(large).toString('base64'));
  });
});
