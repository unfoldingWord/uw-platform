import { describeHubContract } from '@uw/harness/port-contracts/hub';
import { createSimHub } from './hub.ts';

describeHubContract('the recording sim hub', async () => {
  const hub = createSimHub();
  return { hub, wakes: async () => hub.wakes(), enter: async (query) => hub.enter(query) };
});
