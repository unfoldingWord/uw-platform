import { readMetric } from '../../measures/metric-reads.ts';
import { gatedHandler, refusal } from '../handler.ts';
import { hiddenMeasure, storedMeasureArea } from './measure-scene.ts';

export const readMetricVerb = gatedHandler({
  name: 'read_metric',
  hidden: hiddenMeasure,
  resource: storedMeasureArea,
  run: async (context, input) => {
    const { db, principal, at } = context;
    const read = await readMetric({ db, actor: principal, at }, input);
    if (read.ok) return { status: 'accepted', output: read.value };
    if (read.reason === 'property_not_found') return refusal(read.reason, { metric: input.metric });
    return hiddenMeasure(input);
  },
});
