import type { EventPage, EventQuery, Ports } from '../ports.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome } from '../outcome.ts';
import { readableHarness } from '../reads/scene.ts';

export type EventReads = {
  read(
    caller: Caller,
    query: EventQuery,
    options?: { readonly at: Date },
  ): Promise<KernelOutcome<EventPage>>;
};

export function createEventReads(ports: Ports): EventReads {
  return {
    read: async (caller, query, options) => {
      const at = options?.at ?? ports.clock.now();
      return ports.store.transaction(async (tx) => {
        const harness = await readableHarness(ports, tx, caller, query.harnessId, at);
        if (harness === null) return refused('harness_not_found', { harnessId: query.harnessId });
        return accepted(await tx.harnessEvents.read.page(query));
      });
    },
  };
}
