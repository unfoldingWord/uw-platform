import { eq } from 'drizzle-orm';
import { pageSchema, type Page } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { withoutWithheld } from './property-rules.ts';

export type PageRow = typeof pages.$inferSelect;

export function toPage(row: PageRow): Page {
  return pageSchema.parse({
    id: row.id,
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

export async function readPage(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
): Promise<Page | null> {
  const [row] = await db.select().from(pages).where(eq(pages.id, pageId));
  if (!row) return null;
  const page = toPage(row);
  if (!can(actor, 'read', { kind: 'area', area: page.jdArea }, at)) return null;
  return withoutWithheld(db, actor, page, row.collectionId, at);
}
