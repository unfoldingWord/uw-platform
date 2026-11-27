import { storySummaries } from '../../stories/story-records.ts';
import { rowFilteredHandler } from '../handler.ts';

export const listStoriesVerb = rowFilteredHandler({
  name: 'list_stories',
  rows: (context, input) => storySummaries(context.db, context.principal, input, context.at),
  resources: async () => (story) => ({ kind: 'area', area: story.jdArea }),
  reply: (stories) => ({ status: 'accepted', output: { stories: [...stories] } }),
});
