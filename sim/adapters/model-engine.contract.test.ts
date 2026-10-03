import { describeModelEngineContract } from '@uw/harness/port-contracts/model-engine';
import { createSimClock } from './clock.ts';
import { createSimModelEngine } from './model-engine.ts';

describeModelEngineContract('the scripted sim model engine', async () => {
  const clock = createSimClock(new Date('2026-10-01T09:30:00.000Z'));
  const engine = createSimModelEngine(clock);
  return {
    engine,
    respondNextWith: async (result) => engine.respondNextWith(result),
    setSpend: async (amount) => engine.setSpend(amount),
    now: () => clock.now(),
  };
});
