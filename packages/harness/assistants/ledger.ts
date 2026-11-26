import type { EventName, HarnessEvent } from '@uw/contracts';
import type { AssistantLedgerSubject, AssistantRequestRow, StoreTransaction } from '../ports.ts';

const LIFECYCLE_EVENTS_MOST = 100;

class RequestLedgerFullError extends Error {
  constructor(requestId: string) {
    super(`the lifecycle events of assistant request ${requestId} exceed the read bound`);
    this.name = 'RequestLedgerFullError';
  }
}

async function lifecycleOf(
  tx: StoreTransaction,
  request: AssistantRequestRow,
  about: AssistantLedgerSubject,
  names: readonly EventName[],
): Promise<readonly HarnessEvent[]> {
  const events = await tx.harnessEvents.read.assistantLedger({
    harnessId: request.harnessId,
    names,
    about,
    limit: LIFECYCLE_EVENTS_MOST,
  });
  if (events.length >= LIFECYCLE_EVENTS_MOST) throw new RequestLedgerFullError(request.id);
  return events;
}

export function requestEvents(
  tx: StoreTransaction,
  request: AssistantRequestRow,
  names: readonly EventName[],
): Promise<readonly HarnessEvent[]> {
  return lifecycleOf(tx, request, { requestId: request.id }, names);
}

export function effectEvents(
  tx: StoreTransaction,
  request: AssistantRequestRow,
  effectId: string,
  names: readonly EventName[],
): Promise<readonly HarnessEvent[]> {
  return lifecycleOf(tx, request, { effectId }, names);
}

export type StartedTurn = {
  readonly turnId: string;
  readonly attemptId: string;
  readonly delegationId: string;
  readonly at: Date;
};

function startedOf(event: HarnessEvent): StartedTurn | null {
  const { turnId, attemptId, delegationId } = event.evidence;
  if (typeof turnId !== 'string' || typeof attemptId !== 'string') return null;
  if (typeof delegationId !== 'string') return null;
  return { turnId, attemptId, delegationId, at: new Date(event.at) };
}

export function startedTurn(
  events: readonly HarnessEvent[],
  turnId: string | null,
): StartedTurn | null {
  for (const event of events) {
    if (event.name !== 'assistant_turn_started') continue;
    const started = startedOf(event);
    if (started !== null && (turnId === null || started.turnId === turnId)) return started;
  }
  return null;
}

export function anyNamed(events: readonly HarnessEvent[], name: EventName): boolean {
  return events.some((event) => event.name === name);
}
