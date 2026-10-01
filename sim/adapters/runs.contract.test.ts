import { describeRunsContract } from '@uw/harness/port-contracts/runs';
import { createSimRuns } from './runs.ts';

describeRunsContract('the in-process sim runs', async () => {
  const runs = createSimRuns();
  return { runs, finish: async (runId, state) => runs.finish(runId, state) };
});
