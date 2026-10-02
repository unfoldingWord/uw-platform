import { searchPages } from '../../pages/reads.ts';
import { rowFilteredHandler } from '../handler.ts';

export const searchPagesVerb = rowFilteredHandler({
  name: 'search_pages',
  run: async (context, input) => {
    const query = { text: input.query, type: input.type, limit: input.limit };
    const found = await searchPages(context.db, context.principal, query, context.at);
    return { status: 'accepted', output: { pages: [...found] } };
  },
});
