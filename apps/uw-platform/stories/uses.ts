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

export type StoryVersion = { readonly pageId: string; readonly version: number };

export type StoryUseInput = {
  readonly stories: readonly StoryVersion[];
  readonly channel: RenderChannel;
  readonly kind: StoryUseKind;
  readonly reference: string;
  readonly usedBy: string;
  readonly at: Date;
};

function firstOfEach(drawn: readonly StoryVersion[]): readonly StoryVersion[] {
  const seen = new Map<string, StoryVersion>();
  for (const each of drawn) if (!seen.has(each.pageId)) seen.set(each.pageId, each);
  return [...seen.values()].sort((a, b) => a.pageId.localeCompare(b.pageId));
}

export async function storiesOnly(
  db: Executor,
  drawn: readonly StoryVersion[],
): Promise<readonly StoryVersion[]> {
  const each = firstOfEach(drawn);
  if (each.length === 0) return [];
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        inArray(
          pages.id,
          each.map((one) => one.pageId),
        ),
        eq(pages.type, STORY_TYPE),
      ),
    );
  const stories = new Set(rows.map((row) => row.id));
  return each.filter((one) => stories.has(one.pageId));
}

export async function recordStoryUses(db: Executor, input: StoryUseInput): Promise<number> {
  const stories = await storiesOnly(db, input.stories);
  if (stories.length === 0) return 0;
  const { channel, kind, reference, usedBy, at } = input;
  await db.insert(storyUses).values(
    stories.map((story) => ({
      pageId: story.pageId,
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
