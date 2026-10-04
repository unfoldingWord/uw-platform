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

async function sendAll(ports: Ports, events: readonly HarnessEvent[]): Promise<void> {
  const wakes = await planWakes(ports, events);
  await Promise.allSettled(wakes.map((wake) => deliver(ports, wake)));
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
