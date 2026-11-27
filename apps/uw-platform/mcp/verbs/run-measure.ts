import { requestRun } from '../../measures/run-now.ts';
import { gatedHandler, refusal } from '../handler.ts';
import { hiddenMeasure, storedMeasureArea } from './measure-scene.ts';

export const runMeasureVerb = gatedHandler({
  name: 'run_measure',
  hidden: hiddenMeasure,
  resource: storedMeasureArea,
  run: async (context, input) => {
    const { db, principal, traceId, at } = context;
    const starter = { binding: context.measureRun ?? null, traceId };
    const asked = { measureId: input.measureId, expectedVersion: null };
    const started = await requestRun(db, principal, asked, starter, at);
    if (!started.ok) {
      if (started.reason === 'page_not_found') return hiddenMeasure(input);
      return refusal(started.reason);
    }
    const output = { runId: started.runId, measureId: input.measureId, state: started.state };
    return { status: 'accepted', output };
  },
});
