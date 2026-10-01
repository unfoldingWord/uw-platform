import { describeNotifierContract } from '@uw/harness/port-contracts/notifier';
import { createSimNotifier } from './notifier.ts';

describeNotifierContract('the recording sim notifier', async () => {
  const notifier = createSimNotifier();
  return {
    notifier,
    delivered: async () => notifier.delivered(),
    failNext: async () => notifier.failNext(),
  };
});
