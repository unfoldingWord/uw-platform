import { and, eq, like } from 'drizzle-orm';
import type { Executor } from '@uw/db/client';
import { pageFiles } from '@uw/db/schema';
import { fileKindsOf } from './render-page.ts';

const VIDEO_TYPES = 'video/%';

export async function editorVideos(
  db: Executor,
  pageId: string,
  bodyMd: string,
): Promise<ReadonlySet<string>> {
  const embedded = await fileKindsOf(db, [bodyMd]);
  const uploaded = await db
    .select({ id: pageFiles.id })
    .from(pageFiles)
    .where(and(eq(pageFiles.pageId, pageId), like(pageFiles.contentType, VIDEO_TYPES)));
  return new Set([
    ...[...embedded].flatMap(([id, kind]) => (kind === 'video' ? [id] : [])),
    ...uploaded.map((row) => row.id),
  ]);
}
