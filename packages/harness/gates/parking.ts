import type { EventName, HarnessEvent, ItemState } from '@uw/contracts';

const approvals: ReadonlySet<EventName> = new Set<EventName>(['gate_approved', 'gate_overridden']);

const connectorOutcomes: ReadonlySet<EventName> = new Set<EventName>([
  'connector_succeeded',
  'connector_refused',
]);

const parkingChanges: ReadonlySet<EventName> = new Set<EventName>([
  'gate_approved',
  'gate_overridden',
  'gate_rejected',
  'gate_taken_over',
  'submitted_to_gate',
]);

function sinceLastParking(events: readonly HarnessEvent[]): readonly HarnessEvent[] {
  const parkedAt = events.findLastIndex(
    (event) => event.name === 'submitted_to_gate' && event.evidence['result'] === 'parked',
  );
  return events.slice(parkedAt + 1);
}

export function decisionInFlight(events: readonly HarnessEvent[]): boolean {
  const since = sinceLastParking(events);
  const approvedAt = since.findLastIndex((event) => approvals.has(event.name));
  if (approvedAt < 0) return false;
  return !since.slice(approvedAt + 1).some((event) => connectorOutcomes.has(event.name));
}

const exits: ReadonlySet<EventName> = new Set<EventName>(['stage_advanced', 'loop_edge_taken']);

function indexOfDecision(events: readonly HarnessEvent[], decisionId: string): number {
  return events.findIndex(
    (event) => approvals.has(event.name) && event.evidence['decisionId'] === decisionId,
  );
}

export function parkingChangedSince(events: readonly HarnessEvent[], decisionId: string): boolean {
  const decidedAt = indexOfDecision(events, decisionId);
  if (decidedAt < 0) return true;
  return events.slice(decidedAt + 1).some((event) => parkingChanges.has(event.name));
}

export function outcomeRecordedSince(events: readonly HarnessEvent[], decisionId: string): boolean {
  const decidedAt = indexOfDecision(events, decisionId);
  if (decidedAt < 0) return false;
  return events.slice(decidedAt + 1).some((event) => connectorOutcomes.has(event.name));
}

function exitedInItsDecision(events: readonly HarnessEvent[], index: number): boolean {
  const [approval, next] = [events.at(index), events.at(index + 1)];
  return next !== undefined && exits.has(next.name) && next.traceId === approval?.traceId;
}

export function approvalsAwaitingOutcome(events: readonly HarnessEvent[]): readonly number[] {
  return events.flatMap((event, index) => {
    if (!approvals.has(event.name) || exitedInItsDecision(events, index)) return [];
    const decisionId = event.evidence['decisionId'];
    if (typeof decisionId !== 'string') return [];
    return outcomeRecordedSince(events, decisionId) ? [] : [index];
  });
}

export function sameChange(before: ItemState, after: ItemState): boolean {
  const [was, now] = [before.pullRequest, after.pullRequest];
  const samePullRequest =
    was === null || now === null ? was === now : was.repo === now.repo && was.number === now.number;
  return samePullRequest && before.expectedHead === after.expectedHead;
}
