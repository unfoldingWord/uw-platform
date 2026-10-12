import { eventQuerySchema, harnessSchema } from '@uw/contracts';
import type { EventPage, EventQuery, Ports, StoreTransaction } from '../ports.ts';
import type { Caller } from '../caller.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import { readableHarness, type ScenePorts } from '../reads/scene.ts';

export type EventReads = {
  read(
    caller: Caller,
    query: EventQuery,
    options?: { readonly at: Date },
  ): Promise<KernelOutcome<EventPage>>;
};

const uuid = harnessSchema.shape.id;
const { after: afterSchema, limit: limitSchema } = eventQuerySchema.shape;

function queryRefusal(query: EventQuery): Refused | null {
  const { after, limit, itemId } = query;
  if (typeof after !== 'number' || !afterSchema.safeParse(after).success) {
    return refused('malformed_command', { why: 'after' });
  }
  if (typeof limit !== 'number' || !limitSchema.safeParse(limit).success) {
    return refused('malformed_command', { why: 'limit' });
  }
  if (itemId !== null && !uuid.safeParse(itemId).success) {
    return refused('malformed_command', { why: 'item' });
  }
  return null;
}

function refusalOf(query: EventQuery): Refused | null {
  if (!uuid.safeParse(query.harnessId).success) {
    return refused('harness_not_found', { harnessId: query.harnessId });
  }
  return queryRefusal(query);
}

export async function readEventPage(
  ports: ScenePorts,
  tx: StoreTransaction,
  caller: Caller,
  query: EventQuery,
  at: Date,
): Promise<KernelOutcome<EventPage>> {
  const refusal = refusalOf(query);
  if (refusal !== null) return refusal;
  const harness = await readableHarness(ports, tx, caller, query.harnessId, at);
  if (harness === null) return refused('harness_not_found', { harnessId: query.harnessId });
  return accepted(await tx.harnessEvents.read.page(query));
}

export function createEventReads(ports: Ports): EventReads {
  return {
    read: async (caller, query, options) => {
      const at = options?.at ?? ports.clock.now();
      const refusal = refusalOf(query);
      if (refusal !== null) return refusal;
      return ports.store.transaction((tx) => readEventPage(ports, tx, caller, query, at));
    },
  };
}
