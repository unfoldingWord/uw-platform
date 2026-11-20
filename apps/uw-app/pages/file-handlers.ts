import type { Context } from 'hono';
import { z } from 'zod';
import { fileReplySchema, MAX_FILE_BYTES, pageFilesReplySchema } from '@uw/contracts';
import type { AppEnv } from '../deps.ts';
import { refuse } from '../http/outcomes.ts';
import { bucketFiles } from './file-store.ts';
import { bufferOf, filesOfPage, serveFile, storeFile } from './files.ts';

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

async function boundedBytes(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_FILE_BYTES) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  return bytes.byteLength > MAX_FILE_BYTES ? null : bytes;
}

function fileName(name: string): string {
  return name.replace(/[^\w. -]/g, '_');
}

export async function uploadFile(c: Context<AppEnv>): Promise<Response> {
  const database = c.get('database');
  if (database === null) return refuse(c, 'database_not_configured');
  const actor = c.get('principal');
  if (actor === null) return refuse(c, 'unauthenticated');
  if (c.env.FILES === undefined) return refuse(c, 'not_wired');
  const fileId = z.uuid().safeParse(c.req.param('fileId'));
  const pageId = z.uuid().safeParse(c.req.query('page'));
  if (!fromThisSite(c.req.raw) || !fileId.success || !pageId.success) {
    return refuse(c, 'malformed_command');
  }
  const bytes = await boundedBytes(c.req.raw);
  if (bytes === null) return refuse(c, 'file_too_large');
  const upload = {
    fileId: fileId.data,
    pageId: pageId.data,
    name: c.req.query('name') ?? 'file',
    contentType: mediaType(c.req.raw),
    bytes,
  };
  const reader = { actor, at: c.get('now') };
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
