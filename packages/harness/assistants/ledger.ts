import type { EventName, HarnessEvent } from '@uw/contracts';
import type { AssistantRequestRow, StoreTransaction } from '../ports.ts';

const REQUEST_EVENTS_MOST = 5000;

class RequestLedgerFullError extends Error {
  constructor(requestId: string) {
    super(`the events of assistant request ${requestId} exceed the read bound`);
    this.name = 'RequestLedgerFullError';
  }
}

export async function eventsSince(
  tx: StoreTransaction,
  request: AssistantRequestRow,
  names: readonly EventName[],
): Promise<readonly HarnessEvent[]> {
  const events = await tx.harnessEvents.read.recent({
    since: request.recordedAt,
    names,
    agentsOnly: false,
    limit: REQUEST_EVENTS_MOST,
    harnessIds: [request.harnessId],
  });
  if (events.length >= REQUEST_EVENTS_MOST) throw new RequestLedgerFullError(request.id);
  return events;
}

export function evidenceNamed(
  events: readonly HarnessEvent[],
  field: 'requestId' | 'effectId',
  value: string,
): readonly HarnessEvent[] {
  return events.filter((event) => {
    const evidence =
      field === 'requestId' ? event.evidence['requestId'] : event.evidence['effectId'];
    return evidence === value;
  });
}

export function startedTurn(events: readonly HarnessEvent[], turnId: string): boolean {
  return events.some(
    (event) => event.name === 'assistant_turn_started' && event.evidence['turnId'] === turnId,
  );
}

export function anyNamed(events: readonly HarnessEvent[], name: EventName): boolean {
  return events.some((event) => event.name === name);
}
