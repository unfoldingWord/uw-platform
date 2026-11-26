import { describe, expect, it } from 'vitest';
import type { AssistantChannel } from '@uw/contracts';
import type { DirectMessage, DirectMessages } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type DirectMessagesSubject = {
  readonly directMessages: DirectMessages;
  delivered(): Promise<readonly DirectMessage[]>;
  bind(personId: string, channel: AssistantChannel, address: string): Promise<void>;
};

const message: DirectMessage = {
  requestId: 'b5000000-0000-4000-8000-000000000001',
  effectId: 'b5000000-0000-4000-8000-000000000002',
  personId: 'b5000000-0000-4000-8000-000000000005',
  channel: 'zulip_dm',
  replyAddress: 'zulip:5005',
  threadKey: 'dm',
  text: 'You have nothing booked.',
  traceId: 'b5000000-0000-4000-8000-000000000003',
  sendBy: new Date('2100-01-01T00:00:00.000Z'),
};

async function bound(open: () => Promise<DirectMessagesSubject>): Promise<DirectMessagesSubject> {
  const subject = await open();
  await subject.bind(message.personId, message.channel, message.replyAddress);
  return subject;
}

function describeSend(open: () => Promise<DirectMessagesSubject>): void {
  it("sends a message for a fresh effect id to its owner's verified binding", async () => {
    const subject = await bound(open);
    await expect(subject.directMessages.send(message)).resolves.toEqual({ outcome: 'sent' });
    const delivered = await subject.delivered();
    expect(delivered.map((sent) => [sent.effectId, sent.replyAddress, sent.text])).toEqual([
      [message.effectId, message.replyAddress, message.text],
    ]);
  });

  it('answers sent for a repeated effect id and delivers it once', async () => {
    const subject = await bound(open);
    await subject.directMessages.send(message);
    await expect(subject.directMessages.send(message)).resolves.toEqual({ outcome: 'sent' });
    expect(await subject.delivered()).toHaveLength(1);
  });

  it('delivers a second effect separately', async () => {
    const subject = await bound(open);
    const second = { ...message, effectId: 'b5000000-0000-4000-8000-000000000004' };
    await subject.directMessages.send(message);
    await subject.directMessages.send(second);
    expect((await subject.delivered()).map((sent) => sent.effectId)).toEqual([
      message.effectId,
      second.effectId,
    ]);
  });
}

function describeDeadline(open: () => Promise<DirectMessagesSubject>): void {
  it('delivers nothing once the send-by time has passed, and answers deadline_passed', async () => {
    const subject = await bound(open);
    const late = { ...message, sendBy: new Date('2000-01-01T00:00:00.000Z') };
    await expect(subject.directMessages.send(late)).resolves.toEqual({
      outcome: 'deadline_passed',
    });
    expect(await subject.delivered()).toEqual([]);
  });
}

function describeOwner(open: () => Promise<DirectMessagesSubject>): void {
  it("delivers nothing to an address that is not the owner's binding", async () => {
    const subject = await open();
    await subject.bind(message.personId, message.channel, 'zulip:6006');
    await expect(subject.directMessages.send(message)).resolves.toEqual({ outcome: 'not_paired' });
    expect(await subject.delivered()).toEqual([]);
  });

  it("delivers nothing to another person's binding", async () => {
    const subject = await open();
    await subject.bind(
      'b5000000-0000-4000-8000-000000000006',
      message.channel,
      message.replyAddress,
    );
    await expect(subject.directMessages.send(message)).resolves.toEqual({ outcome: 'not_paired' });
    expect(await subject.delivered()).toEqual([]);
  });

  it('delivers nothing on a channel the owner has not bound', async () => {
    const subject = await open();
    await subject.bind(message.personId, 'email', message.replyAddress);
    await expect(subject.directMessages.send(message)).resolves.toEqual({ outcome: 'not_paired' });
    expect(await subject.delivered()).toEqual([]);
  });
}

export function describeDirectMessagesContract(
  adapter: string,
  open: () => Promise<DirectMessagesSubject>,
): void {
  describe(`DX-3 direct messages port contract on ${adapter}`, () => {
    describeSend(open);
    describeOwner(open);
    describeDeadline(open);
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
