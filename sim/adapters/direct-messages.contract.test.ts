import { describeDirectMessagesContract } from '@uw/harness/port-contracts/direct-messages';
import { describe, expect, it } from 'vitest';
import { createSimDirectMessages } from './direct-messages.ts';

describeDirectMessagesContract('the recording sim direct messages', async () => {
  const directMessages = createSimDirectMessages();
  return { directMessages, delivered: async () => directMessages.sent() };
});

describe('the sim direct messages fail on request', () => {
  it('answers the outcome it was told once, delivers nothing, then sends again', async () => {
    const directMessages = createSimDirectMessages();
    const message = {
      requestId: 'b6000000-0000-4000-8000-000000000001',
      effectId: 'b6000000-0000-4000-8000-000000000002',
      channel: 'zulip_dm' as const,
      replyAddress: 'zulip:5005',
      threadKey: null,
      text: 'Done.',
      traceId: 'b6000000-0000-4000-8000-000000000003',
    };
    directMessages.failNextWith('not_paired');
    await expect(directMessages.send(message)).resolves.toEqual({ outcome: 'not_paired' });
    expect(directMessages.sent()).toEqual([]);
    await expect(directMessages.send(message)).resolves.toEqual({ outcome: 'sent' });
    expect(directMessages.sent()).toHaveLength(1);
  });
});
