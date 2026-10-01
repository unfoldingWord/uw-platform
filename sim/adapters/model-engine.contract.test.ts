import { describeModelEngineContract } from '@uw/harness/port-contracts/model-engine';
import { createSimModelEngine } from './model-engine.ts';

describeModelEngineContract('the scripted sim model engine', async () => {
  const engine = createSimModelEngine();
  return { engine, respondNextWith: async (result) => engine.respondNextWith(result) };
});
