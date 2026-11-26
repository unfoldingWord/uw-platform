import { describeDirectMessagesContract } from '@uw/harness/port-contracts/direct-messages';
import { describe, expect, it } from 'vitest';
import { createSimClock } from './clock.ts';
import { createSimDirectMessages } from './direct-messages.ts';

const start = new Date('2026-10-01T09:00:00.000Z');

describeDirectMessagesContract('the recording sim direct messages', async () => {
  const directMessages = createSimDirectMessages(createSimClock(start));
  return {
    directMessages,
    delivered: async () => directMessages.sent(),
    bind: async (personId, channel, address) => directMessages.bind(personId, channel, address),
  };
});

describe('the sim direct messages fail on request', () => {
  it('answers the outcome it was told once, delivers nothing, then sends again', async () => {
    const directMessages = createSimDirectMessages(createSimClock(start));
    directMessages.bind('b6000000-0000-4000-8000-000000000004', 'zulip_dm', 'zulip:5005');
    const message = {
      requestId: 'b6000000-0000-4000-8000-000000000001',
      effectId: 'b6000000-0000-4000-8000-000000000002',
      personId: 'b6000000-0000-4000-8000-000000000004',
      channel: 'zulip_dm' as const,
      replyAddress: 'zulip:5005',
      threadKey: null,
      text: 'Done.',
      traceId: 'b6000000-0000-4000-8000-000000000003',
      sendBy: new Date('2026-10-01T09:05:00.000Z'),
    };
    directMessages.failNextWith('not_paired');
    await expect(directMessages.send(message)).resolves.toEqual({ outcome: 'not_paired' });
    expect(directMessages.sent()).toEqual([]);
    await expect(directMessages.send(message)).resolves.toEqual({ outcome: 'sent' });
    expect(directMessages.sent()).toHaveLength(1);
  });
});
