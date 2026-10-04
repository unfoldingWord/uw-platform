import type { HarnessEvent, WakeReason } from '@uw/contracts';
import { rankOf } from './rank.ts';

export type Trigger = { readonly event: HarnessEvent; readonly reason: WakeReason };

const direct: ReadonlyMap<string, WakeReason> = new Map<string, WakeReason>([
  ['delegation_lapsed', 'delegation_lapsed'],
  ['run_failed', 'run_failed'],
  ['stage_advanced', 'stage_advanced'],
  ['handed_to_person', 'handed_to_person'],
]);

function reasonOf(event: HarnessEvent): WakeReason | null {
  if (event.name === 'submitted_to_gate') {
    return event.evidence['result'] === 'parked' ? 'gate_waiting' : null;
  }
  return direct.get(event.name) ?? null;
}

export function triggersOf(events: readonly HarnessEvent[]): readonly Trigger[] {
  const triggers = events.flatMap((event): Trigger[] => {
    const reason = reasonOf(event);
    return reason === null ? [] : [{ event, reason }];
  });
  return triggers.toSorted(
    (a, b) => rankOf(b.reason) - rankOf(a.reason) || a.event.position - b.event.position,
  );
}
