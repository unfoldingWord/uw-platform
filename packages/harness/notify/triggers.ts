import type { HarnessEvent, WakeReason } from '@uw/contracts';
import { rankOf } from './rank.ts';

export type Trigger = { readonly event: HarnessEvent; readonly reason: WakeReason };

const direct: ReadonlyMap<string, WakeReason> = new Map<string, WakeReason>([
  ['delegation_lapsed', 'delegation_lapsed'],
  ['run_failed', 'run_failed'],
  ['stage_advanced', 'stage_advanced'],
  ['handed_to_person', 'handed_to_person'],
  ['delegated_merge', 'delegated_merge'],
]);

function approvedItems(events: readonly HarnessEvent[]): ReadonlySet<string> {
  return new Set(
    events.flatMap((event) =>
      event.name === 'gate_approved' && event.itemId !== null ? [event.itemId] : [],
    ),
  );
}

function reasonOf(event: HarnessEvent, approved: ReadonlySet<string>): WakeReason | null {
  if (event.name !== 'submitted_to_gate') return direct.get(event.name) ?? null;
  if (event.evidence['result'] !== 'parked') return null;
  return event.itemId !== null && approved.has(event.itemId) ? null : 'gate_waiting';
}

export function triggersOf(events: readonly HarnessEvent[]): readonly Trigger[] {
  const approved = approvedItems(events);
  const triggers = events.flatMap((event): Trigger[] => {
    const reason = reasonOf(event, approved);
    return reason === null ? [] : [{ event, reason }];
  });
  return triggers.toSorted(
    (a, b) => rankOf(b.reason) - rankOf(a.reason) || a.event.position - b.event.position,
  );
}
