import { readPageIn } from '../../pages/store.ts';
import { recordStoryUses } from '../../stories/uses.ts';
import { gatedHandler, refusal } from '../handler.ts';
import { hiddenPage, storedPageArea } from './page-scene.ts';

export const readPageVerb = gatedHandler({
  name: 'read_page',
  hidden: hiddenPage,
  resource: storedPageArea,
  run: async (context, input) => {
    const { db, principal, at } = context;
    const page = await readPageIn(db, principal, input.pageId, at, input.channel);
    if (page === null) return hiddenPage(input);
    if (page === 'story_above_channel') {
      return refusal('story_above_channel', { pageId: input.pageId });
    }
    if (input.channel !== 'platform') {
      const use = {
        kind: 'agent_read',
        reference: 'read_page',
        usedBy: principal.identity,
      } as const;
      const stories = [{ pageId: page.id, version: page.version }];
      await recordStoryUses(db, { stories, channel: input.channel, at, ...use });
    }
    return { status: 'accepted', output: { page } };
  },
});
