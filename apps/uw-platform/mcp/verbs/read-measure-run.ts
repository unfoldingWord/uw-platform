import { measureRunFor } from '../../measures/run-reads.ts';
import { gatedHandler, refusal } from '../handler.ts';
import { hiddenMeasure, storedMeasureArea } from './measure-scene.ts';

export const readMeasureRunVerb = gatedHandler({
  name: 'read_measure_run',
  hidden: hiddenMeasure,
  resource: storedMeasureArea,
  run: async (context, input) => {
    const { db, principal, at } = context;
    const reading = { files: context.files ?? null, at };
    const run = await measureRunFor(db, principal, input, reading);
    if (run !== null) return { status: 'accepted', output: run };
    if (input.runId === null) return refusal('run_not_found', { measureId: input.measureId });
    return refusal('run_not_found', { runId: input.runId });
  },
});
