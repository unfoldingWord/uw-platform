import { readPage } from '../../pages/store.ts';
import { gatedHandler } from '../handler.ts';
import { hiddenPage, storedPageArea } from './page-scene.ts';

export const readPageVerb = gatedHandler({
  name: 'read_page',
  hidden: hiddenPage,
  resource: storedPageArea,
  run: async (context, input) => {
    const page = await readPage(context.db, context.principal, input.pageId, context.at);
    if (page === null) return hiddenPage(input);
    return { status: 'accepted', output: { page } };
  },
});
