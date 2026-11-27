import type { CalendarFailure, HoldMarker } from '@uw/harness';

export type SimCalendarEvent = {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly description: string;
  readonly attendees: readonly string[];
  readonly organisedBySelf: boolean;
  readonly visibility: 'private' | 'default';
  readonly notified: boolean;
  readonly hold: HoldMarker | null;
};

export type SimMail = {
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly replyTo: string | null;
  readonly subject: string;
  readonly body: string;
};

export type SimWorkspaceState = {
  readonly mailboxes: Map<string, string>;
  readonly sent: Map<string, SimMail>;
  readonly emails: Map<string, string>;
  readonly calendars: Map<string, SimCalendarEvent[]>;
  readonly reached: string[];
  next: number;
  failing: CalendarFailure | null;
  trouble: 'throw' | 'hang' | null;
};

export function calendarOf(state: SimWorkspaceState, personId: string): SimCalendarEvent[] {
  const found = state.calendars.get(personId);
  if (found !== undefined) return found;
  const created: SimCalendarEvent[] = [];
  state.calendars.set(personId, created);
  return created;
}

export function troubled(state: SimWorkspaceState): Promise<void> {
  const trouble = state.trouble;
  state.trouble = null;
  if (trouble === 'throw') return Promise.reject(new Error('the workspace connection was reset'));
  if (trouble === 'hang') return new Promise<void>(() => undefined);
  return Promise.resolve();
}

export function failure(state: SimWorkspaceState, personId: string): CalendarFailure | null {
  const failing = state.failing;
  state.failing = null;
  if (failing !== null) return failing;
  return state.emails.has(personId) ? null : 'refused';
}
