import { and, eq } from 'drizzle-orm';
import { sensitivityLevelSchema, type SensitivityLevel } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pages, storyLevels } from '@uw/db/schema';
import { STORY_TYPE } from './channel-filter.ts';

export type StoryPage = {
  readonly id: string;
  readonly jdArea: string;
  readonly title: string;
  readonly version: number;
};

const storyColumns = {
  id: pages.id,
  jdArea: pages.jdArea,
  title: pages.title,
  version: pages.version,
};

export async function storyPageOf(db: Executor, pageId: string): Promise<StoryPage | null> {
  const [row] = await db
    .select(storyColumns)
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.type, STORY_TYPE)));
  return row ?? null;
}

export async function lockedStoryPage(db: Executor, pageId: string): Promise<StoryPage | null> {
  const [row] = await db
    .select(storyColumns)
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.type, STORY_TYPE)))
    .for('update');
  return row ?? null;
}

export async function levelOf(db: Executor, pageId: string): Promise<SensitivityLevel> {
  const [row] = await db
    .select({ level: storyLevels.level })
    .from(storyLevels)
    .where(eq(storyLevels.pageId, pageId));
  return row === undefined ? 'internal' : sensitivityLevelSchema.parse(row.level);
}

export async function keepLevel(
  db: Executor,
  pageId: string,
  level: SensitivityLevel,
  by: string,
  at: Date,
): Promise<void> {
  const set = { level, updatedBy: by, updatedAt: at };
  await db
    .insert(storyLevels)
    .values({ pageId, ...set })
    .onConflictDoUpdate({ target: storyLevels.pageId, set });
}
