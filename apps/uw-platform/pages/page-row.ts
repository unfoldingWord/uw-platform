import { and, eq } from 'drizzle-orm';
import { pageSchema, type Page, type RenderChannel } from '@uw/contracts';
import { can } from '@uw/core/acl';
import type { Principal } from '@uw/core/principal';
import type { Executor } from '@uw/db/client';
import { pages } from '@uw/db/schema';
import { storyChannelFilter } from '../stories/channel-filter.ts';
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
  channel: RenderChannel = 'platform',
): Promise<Page | null> {
  const shown = and(eq(pages.id, pageId), storyChannelFilter(channel, at));
  const [row] = await db.select().from(pages).where(shown);
  if (!row) return null;
  const page = toPage(row);
  if (!can(actor, 'read', { kind: 'area', area: page.jdArea }, at)) return null;
  return withoutWithheld(db, actor, page, row.collectionId, at);
}

export type ChannelRead = Page | 'story_above_channel' | null;

export async function readPageIn(
  db: Executor,
  actor: Principal,
  pageId: string,
  at: Date,
  channel: RenderChannel,
): Promise<ChannelRead> {
  const page = await readPage(db, actor, pageId, at, channel);
  if (page !== null || channel === 'platform') return page;
  const inside = await readPage(db, actor, pageId, at);
  return inside === null ? null : 'story_above_channel';
}
