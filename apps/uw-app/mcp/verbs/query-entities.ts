import { entityQueries } from '../../records/queries.ts';
import { refusal, rowFilteredHandler } from '../handler.ts';

export const queryEntities = rowFilteredHandler({
  name: 'query_entities',
  run: async (context, input) => {
    const query = entityQueries.get(input.query);
    if (query === undefined) return refusal('malformed_command', { why: 'unknown_query' });
    const params = query.params.safeParse(input.params);
    if (!params.success) {
      const fields = params.error.issues.map((issue) =>
        ['params', ...issue.path.map(String)].join('.'),
      );
      return refusal('malformed_command', { fields: [...new Set(fields)] });
    }
    const rows = await query.run(context, params.data);
    if ('status' in rows) return rows;
    return { status: 'accepted', output: { rows: [...rows] } };
  },
});
