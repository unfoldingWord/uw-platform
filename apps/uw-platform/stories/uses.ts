import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  storyUseSchema,
  type RenderChannel,
  type StoryUse,
  type StoryUseKind,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages, storyUses } from '@uw/db/schema';
import { STORY_TYPE } from './channel-filter.ts';

export type StoryUseInput = {
  readonly pageIds: readonly string[];
  readonly channel: RenderChannel;
  readonly kind: StoryUseKind;
  readonly reference: string;
  readonly usedBy: string;
  readonly at: Date;
};

async function storyRows(db: Executor, pageIds: readonly string[]) {
  const ids = [...new Set(pageIds)];
  if (ids.length === 0) return [];
  return db
    .select({ id: pages.id, version: pages.version })
    .from(pages)
    .where(and(inArray(pages.id, ids), eq(pages.type, STORY_TYPE)))
    .orderBy(asc(pages.id));
}

export async function storiesOnly(
  db: Executor,
  pageIds: readonly string[],
): Promise<readonly string[]> {
  return (await storyRows(db, pageIds)).map((row) => row.id);
}

export async function recordStoryUses(db: Executor, input: StoryUseInput): Promise<number> {
  const stories = await storyRows(db, input.pageIds);
  if (stories.length === 0) return 0;
  const { channel, kind, reference, usedBy, at } = input;
  await db.insert(storyUses).values(
    stories.map((story) => ({
      pageId: story.id,
      version: story.version,
      channel,
      kind,
      reference,
      usedBy,
      usedAt: at,
    })),
  );
  return stories.length;
}

export async function storyUsesOf(db: Executor, pageId: string): Promise<readonly StoryUse[]> {
  const rows = await db
    .select()
    .from(storyUses)
    .where(eq(storyUses.pageId, pageId))
    .orderBy(asc(storyUses.usedAt), asc(storyUses.id));
  return rows.map((row) =>
    storyUseSchema.parse({
      pageId: row.pageId,
      version: row.version,
      channel: row.channel,
      kind: row.kind,
      reference: row.reference,
      usedBy: row.usedBy,
      usedAt: row.usedAt.toISOString(),
    }),
  );
}
