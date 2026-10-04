import { describeNotifierContract } from '@uw/harness/port-contracts/notifier';
import { createSimNotifier } from './notifier.ts';

describeNotifierContract('the recording sim notifier', async () => {
  const notifier = createSimNotifier();
  return {
    notifier,
    subscribe: async (personId) => notifier.subscribe(personId),
    enableZulip: async () => notifier.enableZulip(),
    failNext: async () => notifier.failNext(),
    posts: async () => notifier.posts().map(({ topic, reason }) => ({ topic, reason })),
  };
});
