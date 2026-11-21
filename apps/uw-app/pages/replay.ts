import { and, eq } from 'drizzle-orm';
import type { Page } from '@uw/contracts';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pageVersions } from '@uw/db/schema';
import { pageSchema } from '@uw/contracts';

export const REPLAY_INDEX = 'page_versions_request';

export async function replayOf(
  db: Executor,
  actor: Principal,
  requestId: string,
): Promise<Page | null> {
  const [row] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.editSource, actor.identity), eq(pageVersions.requestId, requestId)));
  if (!row) return null;
  return pageSchema.parse({
    id: row.pageId,
    type: row.type,
    jdArea: row.jdArea,
    slug: row.slug,
    title: row.title,
    parentId: row.parentId,
    frontmatter: row.frontmatter,
    bodyMd: row.bodyMd,
    version: row.version,
    status: row.status,
  });
}
