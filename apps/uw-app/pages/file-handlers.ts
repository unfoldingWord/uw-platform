import type { Context } from 'hono';
import { z } from 'zod';
import { fileReplySchema, MAX_FILE_BYTES, pageFilesReplySchema } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { bucketFiles } from './file-store.ts';
import { bufferOf, filesOfPage, serveFile, storeFile, uploadRefusal } from './files.ts';

const inline: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

function fromThisSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin';
}

function mediaType(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function joined(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

export async function boundedBytes(request: Request, most: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get('content-length') ?? '0') > most) return null;
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    received += chunk.value.byteLength;
    if (received > most) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return joined(chunks, received);
}

function fileName(name: string): string {
  return name.replace(/[^\w. -]/g, '_');
}

function askedUpload(c: Context<AppEnv>): { fileId: string; pageId: string } | null {
  const fileId = z.uuid().safeParse(c.req.param('fileId'));
  const pageId = z.uuid().safeParse(c.req.query('page'));
  if (!fromThisSite(c.req.raw) || !fileId.success || !pageId.success) return null;
  return { fileId: fileId.data, pageId: pageId.data };
}

export async function uploadFile(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (c.env.FILES === undefined) return refuse(c, 'not_wired');
  const asked = askedUpload(c);
  if (asked === null) return refuse(c, 'malformed_command');
  const reader = { actor, at: c.get('now') };
  const refusal = await uploadRefusal(database.db, reader, asked.pageId);
  if (refusal !== null) return refuse(c, refusal);
  const bytes = await boundedBytes(c.req.raw, MAX_FILE_BYTES);
  if (bytes === null) return refuse(c, 'file_too_large');
  const upload = {
    ...asked,
    name: c.req.query('name') ?? 'file',
    contentType: mediaType(c.req.raw),
    bytes,
  };
  const result = await storeFile(database.db, bucketFiles(c.env.FILES), reader, upload);
  if (!result.ok) return refuse(c, result.reason);
  c.set('outcome', 'accepted');
  return c.json(fileReplySchema.parse({ status: 'accepted', file: result.file }), 200);
}

export async function downloadFile(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (c.env.FILES === undefined) return refuse(c, 'not_wired');
  const fileId = z.uuid().safeParse(c.req.param('fileId'));
  const reader = { actor, at: c.get('now') };
  const served = fileId.success
    ? await serveFile(database.db, bucketFiles(c.env.FILES), reader, fileId.data)
    : null;
  if (served === null) return refuse(c, 'file_not_found');
  c.set('outcome', 'accepted');
  const { file } = served;
  const placed = inline.has(file.contentType) ? 'inline' : 'attachment';
  const headers = {
    'content-type': file.contentType,
    'content-disposition': `${placed}; filename="${fileName(file.name)}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cache-control': 'private, max-age=3600',
    etag: `"${file.sha256.slice(0, 32)}"`,
  };
  return new Response(bufferOf(served.bytes), { status: 200, headers });
}

export async function listPageFiles(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  const pageId = z.uuid().safeParse(c.req.param('pageId'));
  const reader = { actor, at: c.get('now') };
  const found = pageId.success ? await filesOfPage(database.db, reader, pageId.data) : null;
  if (found === null) return refuse(c, 'page_not_found');
  c.set('outcome', 'accepted');
  return c.json(pageFilesReplySchema.parse({ files: found }), 200);
}
