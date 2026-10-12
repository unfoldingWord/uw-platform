import { describe, expect, it } from 'vitest';
import type { WakeReason } from '@uw/contracts';
import type { Notifier, Wake, WakeRecipient } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type NotifierSubject = {
  readonly notifier: Notifier;
  subscribe(personId: string): Promise<void>;
  enableZulip(): Promise<void>;
  failNext(): Promise<void>;
  posts(): Promise<readonly { readonly topic: string; readonly reason: WakeReason }[]>;
};

const harnessId = 'b4000000-0000-4000-8000-000000000002';
const itemId = 'b4000000-0000-4000-8000-000000000003';
const start = new Date('2026-10-03T09:00:00.000Z');
const minute = 60_000;
let personCount = 0;

function freshPerson(): string {
  personCount += 1;
  return `b4100000-0000-4000-8000-${String(personCount).padStart(12, '0')}`;
}

function recipient(personId: string, present = false): WakeRecipient {
  return { personId, present };
}

function wakeFor(
  recipients: readonly WakeRecipient[],
  reason: WakeReason = 'gate_waiting',
  offsetMinutes = 0,
): Wake {
  return {
    harnessId,
    harnessKey: 'software',
    jdArea: '80-89',
    itemId,
    itemRef: 'item-b4000000',
    topic: 'software/item-b4000000',
    reason,
    link: `/harnesses/${harnessId}/gates/${itemId}`,
    recipients,
    at: new Date(start.getTime() + offsetMinutes * minute),
    traceId: 'b4000000-0000-4000-8000-000000000004',
  };
}

async function subscribed(subject: NotifierSubject): Promise<string> {
  const personId = freshPerson();
  await subject.subscribe(personId);
  return personId;
}

function describePush(open: () => Promise<NotifierSubject>): void {
  it('sends to a subscribed recipient and answers no_device for one with no device', async () => {
    const subject = await open();
    const ana = await subscribed(subject);
    const ben = freshPerson();
    const delivery = await subject.notifier.notify(wakeFor([recipient(ana), recipient(ben)]));
    expect(delivery.push).toEqual([
      { personId: ana, decision: 'sent' },
      { personId: ben, decision: 'no_device' },
    ]);
  });

  it('suppresses a present recipient and spends nothing', async () => {
    const subject = await open();
    const ana = await subscribed(subject);
    const first = await subject.notifier.notify(wakeFor([recipient(ana, true)]));
    expect(first.push).toEqual([{ personId: ana, decision: 'suppressed' }]);
    const second = await subject.notifier.notify(wakeFor([recipient(ana)]));
    expect(second.push).toEqual([{ personId: ana, decision: 'sent' }]);
  });

  it('coalesces an equal wake inside ten minutes, sends a stronger one, and sends at ten minutes', async () => {
    const subject = await open();
    const ana = await subscribed(subject);
    const decide = async (reason: WakeReason, offset: number) =>
      (await subject.notifier.notify(wakeFor([recipient(ana)], reason, offset))).push[0]?.decision;
    expect(await decide('run_failed', 0)).toBe('sent');
    expect(await decide('run_failed', 5)).toBe('coalesced');
    expect(await decide('gate_waiting', 6)).toBe('sent');
    expect(await decide('gate_waiting', 15)).toBe('coalesced');
    expect(await decide('gate_waiting', 16)).toBe('sent');
  });
}

function describeZulip(open: () => Promise<NotifierSubject>): void {
  it('answers not_configured for Zulip while it is off', async () => {
    const subject = await open();
    expect((await subject.notifier.notify(wakeFor([]))).zulip).toBe('not_configured');
  });

  it('posts a gate wake once to its topic whatever the recipient count, and never a stage advance', async () => {
    const subject = await open();
    await subject.enableZulip();
    const many = [recipient(freshPerson()), recipient(freshPerson())];
    expect((await subject.notifier.notify(wakeFor([]))).zulip).toBe('posted');
    expect((await subject.notifier.notify(wakeFor(many))).zulip).toBe('posted');
    expect((await subject.notifier.notify(wakeFor(many, 'stage_advanced'))).zulip).toBe(
      'not_posted',
    );
    expect(await subject.posts()).toEqual([
      { topic: 'software/item-b4000000', reason: 'gate_waiting' },
      { topic: 'software/item-b4000000', reason: 'gate_waiting' },
    ]);
  });
}

function describeFailure(open: () => Promise<NotifierSubject>): void {
  it('answers dropped for push and Zulip after a failure, and does not retry it', async () => {
    const subject = await open();
    await subject.enableZulip();
    const ana = await subscribed(subject);
    await subject.failNext();
    const failed = await subject.notifier.notify(wakeFor([recipient(ana)]));
    expect(failed).toEqual({ push: [{ personId: ana, decision: 'dropped' }], zulip: 'dropped' });
    expect(await subject.posts()).toEqual([]);
    const next = await subject.notifier.notify(wakeFor([recipient(ana)], 'gate_waiting', 10));
    expect(next).toEqual({ push: [{ personId: ana, decision: 'sent' }], zulip: 'posted' });
    expect(await subject.posts()).toHaveLength(1);
  });
}

export function describeNotifierContract(
  adapter: string,
  open: () => Promise<NotifierSubject>,
): void {
  describe(`DX-3 notifier port contract on ${adapter}`, () => {
    describePush(open);
    describeZulip(open);
    describeFailure(open);
  });
}

export function describeNotifierNotWired(adapter: string, notifier: Notifier): void {
  describeNotWired('notifier', adapter, notifier, { notify: true } satisfies Record<
    keyof Notifier,
    true
  >);
}
