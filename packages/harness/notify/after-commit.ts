import type { HarnessEvent } from '@uw/contracts';
import type { Ports } from '../ports.ts';
import { planWakes, type PlannedWake } from './plan.ts';
import { linkTopic } from './topic.ts';
import { triggersOf } from './triggers.ts';

export type AfterCommit = (events: readonly HarnessEvent[]) => Promise<void>;

async function deliver(ports: Ports, { wake, unlinked }: PlannedWake): Promise<void> {
  const delivery = await ports.notifier.notify(wake);
  if (delivery.zulip !== 'posted' || !unlinked || wake.itemId === null) return;
  await linkTopic(ports, {
    itemId: wake.itemId,
    topic: wake.topic,
    at: ports.clock.now(),
    traceId: wake.traceId,
  });
}

type Addressed = {
  readonly wake: { readonly recipients: readonly { readonly personId: string }[] };
};

export async function inPersonOrder<T extends Addressed>(
  wakes: readonly T[],
  send: (wake: T) => Promise<void>,
): Promise<void> {
  const latest = new Map<string, Promise<unknown>>();
  const sends = wakes.map((planned) => {
    const people = planned.wake.recipients.map(({ personId }) => personId);
    const before = people.flatMap((personId) => latest.get(personId) ?? []);
    const sent =
      before.length === 0 ? send(planned) : Promise.allSettled(before).then(() => send(planned));
    const settled = Promise.allSettled([sent]);
    for (const personId of people) latest.set(personId, settled);
    return settled;
  });
  await Promise.all(sends);
}

async function sendAll(ports: Ports, events: readonly HarnessEvent[]): Promise<void> {
  const wakes = await planWakes(ports, events);
  await inPersonOrder(wakes, (wake) => deliver(ports, wake));
}

export function notifyCommitted(ports: Ports): AfterCommit {
  return async (events) => {
    if (triggersOf(events).length === 0) return;
    try {
      await sendAll(ports, events);
    } catch {
      return;
    }
  };
}
