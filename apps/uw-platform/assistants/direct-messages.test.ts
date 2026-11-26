import { describeDirectMessagesNotWired } from '@uw/harness/port-contracts/direct-messages';
import type { Bindings } from '../env.ts';
import { directMessagesOf } from './direct-messages.ts';

const env: Bindings = {};
const database = { db: null as never, ping: async () => undefined, release: async () => undefined };

describeDirectMessagesNotWired(
  'the uw-platform factory until the Zulip direct message slice',
  directMessagesOf({ env, database, fetch: () => Promise.reject(new Error('no send')) }),
);
