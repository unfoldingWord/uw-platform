import type {
  BusyRange,
  CalendarEntry,
  CalendarFailure,
  FreeBusyAnswer,
  Workspace,
} from '@uw/harness';
import { inviteIn, mailIn } from './workspace/sends.ts';
import {
  calendarOf,
  failure,
  type SimCalendarEvent,
  type SimMail,
  type SimWorkspaceState,
} from './workspace/state.ts';

type SimEventInput = {
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly description?: string;
  readonly attendees?: readonly string[];
};

export type SimWorkspace = Workspace & {
  addMailbox(harnessId: string, address: string): void;
  mails(): readonly SimMail[];
  addPerson(personId: string, email: string): void;
  addEvent(personId: string, event: SimEventInput): string;
  events(personId: string): readonly SimCalendarEvent[];
  addressesReached(): readonly string[];
  failNextWith(outcome: CalendarFailure): void;
  throwNext(): void;
  hangNext(): void;
};

const LIST_MOST = 100;

function overlaps(event: SimCalendarEvent, from: Date, to: Date): boolean {
  return event.startsAt.getTime() < to.getTime() && event.endsAt.getTime() > from.getTime();
}

function entryOf(event: SimCalendarEvent): CalendarEntry {
  return {
    eventId: event.eventId,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: false,
    title: event.title,
    location: '',
    description: event.description,
    organisedBySelf: event.organisedBySelf,
    attendees: event.attendees.length,
    hold: event.hold,
  };
}

function byStart(a: SimCalendarEvent, b: SimCalendarEvent): number {
  return a.startsAt.getTime() - b.startsAt.getTime();
}

function listIn(state: SimWorkspaceState): Workspace['listEvents'] {
  return async ({ personId, from, to }) => {
    const failed = failure(state, personId);
    if (failed !== null) return { outcome: failed };
    const inWindow = calendarOf(state, personId)
      .filter((event) => overlaps(event, from, to))
      .sort(byStart);
    return {
      outcome: 'listed',
      entries: inWindow.slice(0, LIST_MOST).map(entryOf),
      truncated: inWindow.length > LIST_MOST,
    };
  };
}

function personByEmail(state: SimWorkspaceState, email: string): string | null {
  for (const [personId, known] of state.emails) if (known === email.toLowerCase()) return personId;
  return null;
}

function busyOf(state: SimWorkspaceState, personId: string, from: Date, to: Date): BusyRange[] {
  return calendarOf(state, personId)
    .filter((event) => overlaps(event, from, to))
    .map((event) => ({ startsAt: event.startsAt, endsAt: event.endsAt }));
}

function freeBusyIn(state: SimWorkspaceState): Workspace['freeBusy'] {
  return async ({ personId, colleagues, from, to }): Promise<FreeBusyAnswer> => {
    const outside = colleagues.filter((email) => personByEmail(state, email) === null);
    if (outside.length > 0) return { outcome: 'outside_organization', addresses: outside };
    const failed = failure(state, personId);
    if (failed !== null) return { outcome: failed };
    state.reached.push(...colleagues);
    const people = [personId, ...colleagues.map((email) => personByEmail(state, email) ?? '')];
    return {
      outcome: 'answered',
      busy: people.flatMap((each) => busyOf(state, each, from, to)),
      unknown: [],
    };
  };
}

function eventIdOf(holdId: string): string {
  return holdId.replaceAll('-', '');
}

function placeIn(state: SimWorkspaceState): Workspace['placeHold'] {
  return async (hold) => {
    const failed = failure(state, hold.personId);
    if (failed !== null) return { outcome: failed };
    const calendar = calendarOf(state, hold.personId);
    const eventId = eventIdOf(hold.holdId);
    if (!calendar.some((event) => event.eventId === eventId)) {
      calendar.push({
        eventId,
        title: hold.title,
        startsAt: hold.startsAt,
        endsAt: hold.endsAt,
        description: '',
        attendees: [],
        organisedBySelf: true,
        visibility: 'private',
        notified: false,
        hold: { harnessId: hold.harnessId, holdId: hold.holdId },
      });
    }
    return { outcome: 'held', eventId };
  };
}

function removeIn(state: SimWorkspaceState): Workspace['removeHold'] {
  return async (removal) => {
    const failed = failure(state, removal.personId);
    if (failed !== null) return { outcome: failed };
    const calendar = calendarOf(state, removal.personId);
    const at = calendar.findIndex((event) => event.eventId === removal.eventId);
    if (at < 0) return { outcome: 'released' };
    const marker = calendar.at(at)?.hold;
    if (marker?.harnessId !== removal.harnessId || marker.holdId !== removal.holdId) {
      return { outcome: 'not_own_hold' };
    }
    calendar.splice(at, 1);
    return { outcome: 'released' };
  };
}

function addEventIn(state: SimWorkspaceState, personId: string, event: SimEventInput): string {
  state.next += 1;
  const eventId = `sim${String(state.next).padStart(6, '0')}`;
  calendarOf(state, personId).push({
    eventId,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    description: event.description ?? '',
    attendees: [...(event.attendees ?? [])],
    organisedBySelf: true,
    visibility: 'default',
    notified: false,
    hold: null,
  });
  return eventId;
}

export function createSimWorkspace(): SimWorkspace {
  const state: SimWorkspaceState = {
    mailboxes: new Map(),
    sent: new Map(),
    emails: new Map(),
    calendars: new Map(),
    reached: [],
    next: 0,
    failing: null,
    trouble: null,
  };
  return {
    listEvents: listIn(state),
    freeBusy: freeBusyIn(state),
    placeHold: placeIn(state),
    removeHold: removeIn(state),
    sendMail: mailIn(state),
    sendInvite: inviteIn(state),
    addMailbox: (harnessId, address) => {
      state.mailboxes.set(harnessId, address);
    },
    mails: () => [...state.sent.values()],
    addPerson: (personId, email) => {
      state.emails.set(personId, email.toLowerCase());
    },
    addEvent: (personId, event) => addEventIn(state, personId, event),
    events: (personId) => calendarOf(state, personId).map((event) => ({ ...event })),
    addressesReached: () => [...state.reached],
    failNextWith: (outcome) => {
      state.failing = outcome;
    },
    throwNext: () => {
      state.trouble = 'throw';
    },
    hangNext: () => {
      state.trouble = 'hang';
    },
  };
}
