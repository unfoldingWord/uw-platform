import type { EventPage, EventQuery, Ports } from '../ports.ts';
import { allowed } from '../access.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';

export type EventReads = {
  read(caller: Caller, query: EventQuery): Promise<KernelOutcome<EventPage>>;
};

export function createEventReads(ports: Ports): EventReads {
  return {
    read: async (caller, query) => {
      const at = ports.clock.now();
      return ports.store.transaction(async (tx) => {
        const harness = await tx.harnesses.read.byId(query.harnessId);
        if (harness === null) return refused('harness_not_found', { harnessId: query.harnessId });
        if (!allowed(caller.actor, 'read', harness, at)) {
          return refused('not_permitted', { harnessId: harness.id });
        }
        return accepted(await tx.harnessEvents.read.page(query));
      });
    },
  };
}
