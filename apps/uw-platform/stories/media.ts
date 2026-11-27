import { and, asc, eq } from 'drizzle-orm';
import {
  levelsShownIn,
  sensitivityLevelSchema,
  storyMayAppear,
  type RenderChannel,
  type SensitivityLevel,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { pageFiles, pages, storyMediaLevels } from '@uw/db/schema';
import { STORY_TYPE, storyChannelFilter } from './channel-filter.ts';

export type StoryMedia = {
  readonly fileId: string;
  readonly name: string;
  readonly level: SensitivityLevel;
};

type Changed = { readonly by: string; readonly at: Date };

function levelOrInternal(level: string | null): SensitivityLevel {
  return level === null ? 'internal' : sensitivityLevelSchema.parse(level);
}

export async function fileOfStory(db: Executor, pageId: string, fileId: string) {
  const [row] = await db
    .select({ id: pageFiles.id })
    .from(pageFiles)
    .where(and(eq(pageFiles.id, fileId), eq(pageFiles.pageId, pageId)));
  return row !== undefined;
}

export async function mediaLevelOf(db: Executor, fileId: string): Promise<SensitivityLevel> {
  const [row] = await db
    .select({ level: storyMediaLevels.level })
    .from(storyMediaLevels)
    .where(eq(storyMediaLevels.fileId, fileId));
  return levelOrInternal(row?.level ?? null);
}

export async function keepMediaLevel(
  db: Executor,
  of: { readonly story: string; readonly file: string },
  level: SensitivityLevel,
  changed: Changed,
): Promise<void> {
  const set = { level, updatedBy: changed.by, updatedAt: changed.at };
  await db
    .insert(storyMediaLevels)
    .values({ fileId: of.file, pageId: of.story, ...set })
    .onConflictDoUpdate({ target: storyMediaLevels.fileId, set });
}

export async function dropMediaLevels(db: Executor, pageId: string, changed: Changed) {
  await db
    .update(storyMediaLevels)
    .set({ level: 'internal', updatedBy: changed.by, updatedAt: changed.at })
    .where(eq(storyMediaLevels.pageId, pageId));
}

export async function mediaOfStory(db: Executor, pageId: string): Promise<readonly StoryMedia[]> {
  const rows = await db
    .select({ fileId: pageFiles.id, name: pageFiles.name, level: storyMediaLevels.level })
    .from(pageFiles)
    .leftJoin(storyMediaLevels, eq(storyMediaLevels.fileId, pageFiles.id))
    .where(eq(pageFiles.pageId, pageId))
    .orderBy(asc(pageFiles.name), asc(pageFiles.id));
  return rows.map((row) => ({ ...row, level: levelOrInternal(row.level) }));
}

export async function fileMayAppear(
  db: Executor,
  fileId: string,
  channel: RenderChannel,
  at: Date,
): Promise<boolean> {
  if (levelsShownIn(channel).includes('internal')) return true;
  const [row] = await db
    .select({ type: pages.type, level: storyMediaLevels.level })
    .from(pageFiles)
    .innerJoin(pages, eq(pages.id, pageFiles.pageId))
    .leftJoin(storyMediaLevels, eq(storyMediaLevels.fileId, pageFiles.id))
    .where(and(eq(pageFiles.id, fileId), storyChannelFilter(channel, at)));
  if (row === undefined) return false;
  return row.type !== STORY_TYPE || storyMayAppear(levelOrInternal(row.level), channel);
}

export async function filesWithheldIn(
  db: Executor,
  fileIds: readonly string[],
  channel: RenderChannel,
  at: Date,
): Promise<ReadonlySet<string>> {
  const withheld = new Set<string>();
  if (levelsShownIn(channel).includes('internal')) return withheld;
  for (const fileId of new Set(fileIds)) {
    if (!(await fileMayAppear(db, fileId, channel, at))) withheld.add(fileId);
  }
  return withheld;
}
