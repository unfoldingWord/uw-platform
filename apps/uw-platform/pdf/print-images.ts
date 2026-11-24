import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { kindOfContentType } from '../markdown/file-video.ts';
import type { FileStore } from '../pages/file-store.ts';
import { serveFile } from '../pages/files.ts';
import type { ImageOf } from './print-html.ts';

type Reader = { readonly actor: Principal; readonly at: Date };

const FILE_ADDRESS =
  /^\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const CHUNK = 0x8000;

export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.byteLength; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

function fileIdOf(src: string, origin: string): string | null {
  const path = src.startsWith(origin) ? src.slice(origin.length) : src;
  return FILE_ADDRESS.exec(path)?.[1] ?? null;
}

export const noImages: ImageOf = async () => null;

export function fileImages(
  db: Executor,
  files: FileStore,
  reader: Reader,
  origin: string,
): ImageOf {
  return async (src) => {
    const fileId = fileIdOf(src, origin);
    if (fileId === null) return null;
    const served = await serveFile(db, files, reader, fileId);
    if (served === null || kindOfContentType(served.file.contentType) !== 'image') return null;
    return `data:${served.file.contentType};base64,${base64Of(served.bytes)}`;
  };
}
