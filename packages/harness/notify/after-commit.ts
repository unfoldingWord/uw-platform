import type { HarnessEvent } from '@uw/contracts';
import type { Ports } from '../ports.ts';
import { planWakes } from './plan.ts';
import { triggersOf } from './triggers.ts';

export type AfterCommit = (events: readonly HarnessEvent[]) => Promise<void>;

async function sendAll(ports: Ports, events: readonly HarnessEvent[]): Promise<void> {
  const wakes = await planWakes(ports, events);
  await Promise.allSettled(wakes.map(async (wake) => ports.notifier.notify(wake)));
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
