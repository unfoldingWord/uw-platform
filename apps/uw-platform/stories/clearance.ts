import { levelsShownIn, storyMayAppear, type ErrorReason, type RenderChannel } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { consentRefusal } from './consent.ts';
import { mediaOfStory } from './media.ts';
import { levelOf } from './story-pages.ts';

async function mediaShownIn(db: Executor, pageId: string, channel: RenderChannel) {
  const media = await mediaOfStory(db, pageId);
  return media.some((file) => storyMayAppear(file.level, channel));
}

async function storyRefusalIn(
  db: Executor,
  pageId: string,
  channel: RenderChannel,
  at: Date,
): Promise<ErrorReason | null> {
  const photo = await mediaShownIn(db, pageId, channel);
  const consent = await consentRefusal(db, pageId, at, photo);
  if (consent !== null) return consent;
  return storyMayAppear(await levelOf(db, pageId), channel) ? null : 'story_above_channel';
}

export async function clearanceRefusal(
  db: Executor,
  pageIds: readonly string[],
  channel: RenderChannel,
  at: Date,
): Promise<ErrorReason | null> {
  if (levelsShownIn(channel).includes('internal')) return null;
  for (const pageId of new Set(pageIds)) {
    const refused = await storyRefusalIn(db, pageId, channel, at);
    if (refused !== null) return refused;
  }
  return null;
}
