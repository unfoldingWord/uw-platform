import { searchPages } from '../../pages/search.ts';
import { rowFilteredHandler } from '../handler.ts';

export const searchPagesVerb = rowFilteredHandler({
  name: 'search_pages',
  rows: (context, input) => {
    const query = {
      text: input.query,
      type: input.type,
      area: null,
      titlesOnly: false,
      liveOnly: false,
      limit: input.limit,
    };
    return searchPages(context.db, context.principal, query, context.at);
  },
  resources: async () => (page) => ({ kind: 'area', area: page.jdArea }),
  reply: (pages) => ({ status: 'accepted', output: { pages: [...pages] } }),
});
