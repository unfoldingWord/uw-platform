import { describe, expect, it } from 'vitest';
import type { DirectMessage, DirectMessages } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type DirectMessagesSubject = {
  readonly directMessages: DirectMessages;
  delivered(): Promise<readonly DirectMessage[]>;
};

const message: DirectMessage = {
  requestId: 'b5000000-0000-4000-8000-000000000001',
  effectId: 'b5000000-0000-4000-8000-000000000002',
  channel: 'zulip_dm',
  replyAddress: 'zulip:5005',
  threadKey: 'dm',
  text: 'You have nothing booked.',
  traceId: 'b5000000-0000-4000-8000-000000000003',
};

function describeSend(open: () => Promise<DirectMessagesSubject>): void {
  it('sends a message for a fresh effect id, to the address it names', async () => {
    const subject = await open();
    await expect(subject.directMessages.send(message)).resolves.toEqual({ outcome: 'sent' });
    const delivered = await subject.delivered();
    expect(delivered.map((sent) => [sent.effectId, sent.replyAddress, sent.text])).toEqual([
      [message.effectId, message.replyAddress, message.text],
    ]);
  });

  it('answers sent for a repeated effect id and delivers it once', async () => {
    const subject = await open();
    await subject.directMessages.send(message);
    await expect(subject.directMessages.send(message)).resolves.toEqual({ outcome: 'sent' });
    expect(await subject.delivered()).toHaveLength(1);
  });

  it('delivers a second effect separately', async () => {
    const subject = await open();
    const second = { ...message, effectId: 'b5000000-0000-4000-8000-000000000004' };
    await subject.directMessages.send(message);
    await subject.directMessages.send(second);
    expect((await subject.delivered()).map((sent) => sent.effectId)).toEqual([
      message.effectId,
      second.effectId,
    ]);
  });
}

export function describeDirectMessagesContract(
  adapter: string,
  open: () => Promise<DirectMessagesSubject>,
): void {
  describe(`DX-3 direct messages port contract on ${adapter}`, () => {
    describeSend(open);
  });
}

export function describeDirectMessagesNotWired(
  adapter: string,
  directMessages: DirectMessages,
): void {
  describeNotWired('directMessages', adapter, directMessages, { send: true } satisfies Record<
    keyof DirectMessages,
    true
  >);
}
