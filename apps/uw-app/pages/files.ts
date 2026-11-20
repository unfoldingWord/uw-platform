import { desc, eq } from 'drizzle-orm';
import {
  fileContentTypes,
  fileSchema,
  MAX_FILE_BYTES,
  type ErrorReason,
  type StoredFileRecord,
} from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageFiles, pages } from '@uw/db/schema';
import type { FileStore } from './file-store.ts';
import { readPage } from './store.ts';

export type FileResult =
  | { readonly ok: true; readonly file: StoredFileRecord }
  | { readonly ok: false; readonly reason: ErrorReason };

export type Upload = {
  readonly fileId: string;
  readonly pageId: string;
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
};

export type Served = { readonly file: StoredFileRecord; readonly bytes: Uint8Array };

type FileRow = typeof pageFiles.$inferSelect;
type Reader = { readonly actor: Principal; readonly at: Date };

const allowed: ReadonlySet<string> = new Set(fileContentTypes);

function refused(reason: ErrorReason): FileResult {
  return { ok: false, reason };
}

function keyOf(row: Pick<FileRow, 'pageId' | 'id'>): string {
  return `pages/${row.pageId}/${row.id}`;
}

function recordOf(row: FileRow): StoredFileRecord {
  return fileSchema.parse({
    id: row.id,
    pageId: row.pageId,
    jdArea: row.jdArea,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    sha256: row.sha256,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    url: `/api/files/${row.id}`,
  });
}

export function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bufferOf(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function shapeRefusal(upload: Upload): ErrorReason | null {
  if (!allowed.has(upload.contentType)) return 'file_type_not_allowed';
  if (upload.bytes.byteLength > MAX_FILE_BYTES) return 'file_too_large';
  const name = upload.name.trim();
  if (upload.bytes.byteLength === 0 || name === '' || name.length > 200) return 'malformed_command';
  return null;
}

export async function storeFile(
  db: Executor,
  store: FileStore,
  reader: Reader,
  upload: Upload,
): Promise<FileResult> {
  const shape = shapeRefusal(upload);
  if (shape !== null) return refused(shape);
  const page = await readPage(db, reader.actor, upload.pageId, reader.at);
  if (page === null) return refused('page_not_found');
  if (!can(reader.actor, 'write', { kind: 'area', area: page.jdArea }, reader.at)) {
    return refused('not_permitted');
  }
  const [held] = await db.select().from(pageFiles).where(eq(pageFiles.id, upload.fileId));
  if (held !== undefined) return { ok: true, file: recordOf(held) };
  await store.put(keyOf({ pageId: page.id, id: upload.fileId }), {
    bytes: upload.bytes,
    contentType: upload.contentType,
  });
  const [row] = await db
    .insert(pageFiles)
    .values({
      id: upload.fileId,
      pageId: page.id,
      jdArea: page.jdArea,
      name: upload.name.trim(),
      contentType: upload.contentType,
      size: upload.bytes.byteLength,
      sha256: await sha256Of(upload.bytes),
      uploadedBy: reader.actor.identity,
    })
    .returning();
  if (!row) throw new Error('a stored file must return its row');
  return { ok: true, file: recordOf(row) };
}

export async function serveFile(
  db: Executor,
  store: FileStore,
  reader: Reader,
  fileId: string,
): Promise<Served | null> {
  const [found] = await db
    .select({ file: pageFiles, area: pages.jdArea })
    .from(pageFiles)
    .innerJoin(pages, eq(pages.id, pageFiles.pageId))
    .where(eq(pageFiles.id, fileId));
  if (found === undefined) return null;
  if (!can(reader.actor, 'read', { kind: 'area', area: found.area }, reader.at)) return null;
  const row = { ...found.file, jdArea: found.area };
  const stored = await store.get(keyOf(row));
  return stored === null ? null : { file: recordOf(row), bytes: stored.bytes };
}

export async function filesOfPage(
  db: Executor,
  reader: Reader,
  pageId: string,
): Promise<readonly StoredFileRecord[] | null> {
  const page = await readPage(db, reader.actor, pageId, reader.at);
  if (page === null) return null;
  const rows = await db
    .select()
    .from(pageFiles)
    .where(eq(pageFiles.pageId, pageId))
    .orderBy(desc(pageFiles.createdAt));
  return rows.map((row) => recordOf({ ...row, jdArea: page.jdArea }));
}
