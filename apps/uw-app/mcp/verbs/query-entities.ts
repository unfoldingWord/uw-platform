import { entityQueries } from '../../records/queries.ts';
import { refusal, rowFilteredHandler } from '../handler.ts';

export const queryEntities = rowFilteredHandler({
  name: 'query_entities',
  rows: async (context, input) => {
    const query = entityQueries.get(input.query);
    if (query === undefined) return refusal('malformed_command', { why: 'unknown_query' });
    const params = query.params.safeParse(input.params);
    if (!params.success) {
      const fields = params.error.issues.map((issue) =>
        ['params', ...issue.path.map(String)].join('.'),
      );
      return refusal('malformed_command', { fields: [...new Set(fields)] });
    }
    return query.run(context, params.data);
  },
  resources: async () => (found) => found.resource,
  reply: (visible) => ({ status: 'accepted', output: { rows: visible.map((found) => found.row) } }),
});
