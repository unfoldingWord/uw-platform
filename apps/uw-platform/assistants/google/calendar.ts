import type {
  BusyRange,
  CalendarEntry,
  CalendarFailure,
  CalendarHold,
  CalendarListing,
  HoldMarker,
  HoldPlacement,
  HoldRemoved,
} from '@uw/harness';
import { z } from 'zod';
import { googleCall, type GoogleAnswer } from './rest.ts';
import { GOOGLE_SCOPES, type TokenDeps } from './token.ts';

const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const EVENTS = `${CALENDAR}/calendars/primary/events`;
const LIST_MOST = 100;
const HARNESS_KEY = 'uwAssistantHarness';
const HOLD_KEY = 'uwAssistantHold';
const eventsScope = [GOOGLE_SCOPES.calendarEvents];

const when = z.object({ dateTime: z.string().optional(), date: z.string().optional() });
const eventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: when,
  end: when,
  organizer: z.object({ self: z.boolean().optional() }).optional(),
  attendees: z.array(z.object({ email: z.string().optional() })).optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
const listSchema = z.object({
  items: z.array(eventSchema).default([]),
  nextPageToken: z.string().optional(),
});
const busySchema = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
      errors: z.array(z.unknown()).optional(),
    }),
  ),
});

type GoogleEvent = z.infer<typeof eventSchema>;
export type FreeBusyRead =
  | {
      readonly outcome: 'answered';
      readonly busy: readonly BusyRange[];
      readonly unknown: readonly string[];
    }
  | { readonly outcome: CalendarFailure };

function eventIdOf(holdId: string): string {
  return holdId.replaceAll('-', '').toLowerCase();
}

function failureOf(answer: GoogleAnswer): CalendarFailure {
  return !answer.ok && answer.failure === 'unavailable' ? 'unavailable' : 'refused';
}

function instantOf(value: z.infer<typeof when>): Date {
  return new Date(value.dateTime ?? `${value.date ?? ''}T00:00:00.000Z`);
}

function markerOf(event: GoogleEvent): HoldMarker | null {
  const props = new Map(Object.entries(event.extendedProperties?.private ?? {}));
  const harnessId = props.get(HARNESS_KEY);
  const holdId = props.get(HOLD_KEY);
  return harnessId !== undefined && holdId !== undefined ? { harnessId, holdId } : null;
}

function entryOf(event: GoogleEvent): CalendarEntry {
  return {
    eventId: event.id,
    startsAt: instantOf(event.start),
    endsAt: instantOf(event.end),
    allDay: event.start.dateTime === undefined,
    title: event.summary ?? '',
    location: event.location ?? '',
    description: event.description ?? '',
    organisedBySelf: event.organizer?.self === true,
    attendees: event.attendees?.length ?? 0,
    hold: markerOf(event),
  };
}

export async function listEvents(
  deps: TokenDeps,
  email: string,
  window: { readonly from: Date; readonly to: Date },
): Promise<CalendarListing> {
  const query = new URLSearchParams({
    timeMin: window.from.toISOString(),
    timeMax: window.to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(LIST_MOST),
  });
  const answer = await googleCall(deps, {
    subject: email,
    scopes: eventsScope,
    method: 'GET',
    url: `${EVENTS}?${query.toString()}`,
  });
  if (!answer.ok) return { outcome: failureOf(answer) };
  const parsed = listSchema.safeParse(answer.body);
  if (!parsed.success) return { outcome: 'unavailable' };
  const live = parsed.data.items.filter((event) => event.status !== 'cancelled');
  return {
    outcome: 'listed',
    entries: live.map(entryOf),
    truncated: parsed.data.nextPageToken !== undefined,
  };
}

export async function freeBusy(
  deps: TokenDeps,
  email: string,
  addresses: readonly string[],
  window: { readonly from: Date; readonly to: Date },
): Promise<FreeBusyRead> {
  const items = [email, ...addresses].map((id) => ({ id }));
  const body = { timeMin: window.from.toISOString(), timeMax: window.to.toISOString(), items };
  const scopes = [GOOGLE_SCOPES.calendarFreeBusy];
  const answer = await googleCall(deps, {
    subject: email,
    scopes,
    method: 'POST',
    url: `${CALENDAR}/freeBusy`,
    body,
  });
  if (!answer.ok) return { outcome: failureOf(answer) };
  const parsed = busySchema.safeParse(answer.body);
  if (!parsed.success) return { outcome: 'unavailable' };
  const calendars = new Map(Object.entries(parsed.data.calendars));
  const unknown = addresses.filter((address) => {
    const found = calendars.get(address);
    return found === undefined || (found.errors?.length ?? 0) > 0;
  });
  const busy = [...calendars.values()].flatMap((calendar) =>
    calendar.busy.map((range) => ({
      startsAt: new Date(range.start),
      endsAt: new Date(range.end),
    })),
  );
  return { outcome: 'answered', busy, unknown };
}

function holdBody(hold: CalendarHold) {
  return {
    id: eventIdOf(hold.holdId),
    summary: hold.title,
    start: { dateTime: hold.startsAt.toISOString() },
    end: { dateTime: hold.endsAt.toISOString() },
    visibility: 'private',
    transparency: 'opaque',
    guestsCanInviteOthers: false,
    extendedProperties: { private: { [HARNESS_KEY]: hold.harnessId, [HOLD_KEY]: hold.holdId } },
  };
}

async function readEvent(deps: TokenDeps, email: string, eventId: string): Promise<GoogleAnswer> {
  const url = `${EVENTS}/${encodeURIComponent(eventId)}`;
  return googleCall(deps, { subject: email, scopes: eventsScope, method: 'GET', url });
}

function ownedBy(body: unknown, marker: HoldMarker): boolean {
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) return false;
  const found = markerOf(parsed.data);
  return found?.harnessId === marker.harnessId && found.holdId === marker.holdId;
}

export async function insertHold(
  deps: TokenDeps,
  email: string,
  hold: CalendarHold,
): Promise<HoldPlacement> {
  const eventId = eventIdOf(hold.holdId);
  const url = `${EVENTS}?sendUpdates=none`;
  const answer = await googleCall(deps, {
    subject: email,
    scopes: eventsScope,
    method: 'POST',
    url,
    body: holdBody(hold),
  });
  if (answer.ok) return { outcome: 'held', eventId };
  if (answer.failure !== 'conflict') return { outcome: failureOf(answer) };
  const existing = await readEvent(deps, email, eventId);
  if (!existing.ok) return { outcome: failureOf(existing) };
  return ownedBy(existing.body, hold) ? { outcome: 'held', eventId } : { outcome: 'refused' };
}

function gone(answer: GoogleAnswer): boolean {
  return !answer.ok && (answer.failure === 'not_found' || answer.failure === 'gone');
}

export async function deleteHold(
  deps: TokenDeps,
  email: string,
  removal: HoldMarker & { readonly eventId: string },
): Promise<HoldRemoved> {
  const existing = await readEvent(deps, email, removal.eventId);
  if (gone(existing)) return { outcome: 'released' };
  if (!existing.ok) return { outcome: failureOf(existing) };
  if (!ownedBy(existing.body, removal)) return { outcome: 'not_own_hold' };
  const url = `${EVENTS}/${encodeURIComponent(removal.eventId)}?sendUpdates=none`;
  const deleted = await googleCall(deps, {
    subject: email,
    scopes: eventsScope,
    method: 'DELETE',
    url,
  });
  if (deleted.ok || gone(deleted)) return { outcome: 'released' };
  return { outcome: failureOf(deleted) };
}
