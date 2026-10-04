import { createLogger } from '@uw/core/log';
import { describeHubContract } from '@uw/harness/port-contracts/hub';
import { hubWakeSchema } from '@uw/contracts';
import { fakeHubNamespace } from '../live/testing.ts';
import { systemTimers } from '../timers.ts';
import { platformHub } from './hub.ts';

const silentLogger = createLogger(
  { traceId: 'trace', commit: 'test-commit', route: 'hub', principal: null },
  () => undefined,
);

describeHubContract(
  'the platform hub over a Durable Object namespace',
  async () => {
    const fake = fakeHubNamespace();
    return {
      hub: platformHub(fake.namespace, silentLogger, systemTimers),
      wakes: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return fake.sent().map((message) => hubWakeSchema.parse(JSON.parse(message)).harnessId);
      },
      enter: async () => {
        throw new Error('presence on the platform hub arrives with step 9 Task 5');
      },
    };
  },
  { presence: false },
);
