import { verbIo } from '@uw/contracts';
import { daysAfterDate, formatZonedMinute, zonedDateOf, zonedInstant } from '@uw/core/dates';
import type { Caller } from '../caller.ts';
import { recordContext } from '../items/record.ts';
import { accepted, refused, type KernelOutcome, type Refused } from '../outcome.ts';
import type { CalendarEntry, Ports } from '../ports.ts';
import { renderUntrusted, untrusted } from '../untrusted.ts';
import { askCalendar, calendarRefusal } from './calendar-port.ts';
import { freeSlots } from './free-slots.ts';
import { DEFAULT_TIMEZONE } from './instructions.ts';
import { addressed, turnSceneOf, type TurnAddress } from './reminder-turn.ts';

export type ReadCalendarInput = TurnAddress & {
  readonly day?: string | undefined;
  readonly days?: number | undefined;
};
export type FindTimeInput = TurnAddress & {
  readonly with: readonly string[];
  readonly minutes: number;
  readonly day?: string | undefined;
  readonly days?: number | undefined;
};
type CalendarEvent = {
  readonly startAt: string;
  readonly endAt: string;
  readonly when: string;
  readonly allDay: boolean;
  readonly organisedByYou: boolean;
  readonly attendees: number;
  readonly holdId: string | null;
  readonly details: string;
};
export type CalendarRead = {
  readonly timezone: string;
  readonly from: string;
  readonly to: string;
  readonly events: readonly CalendarEvent[];
  readonly truncated: boolean;
};
export type FreeTime = {
  readonly timezone: string;
  readonly slots: readonly { startAt: string; endAt: string; when: string }[];
  readonly unknown: readonly string[];
};

type ReadPorts = Pick<Ports, 'clock' | 'grants' | 'ids' | 'store' | 'workspace'>;
type Owner = {
  readonly personId: string;
  readonly harnessId: string;
  readonly timezone: string;
  readonly at: Date;
};
type Span = { readonly from: Date; readonly to: Date; readonly day: string; readonly days: number };

const DESCRIPTION_MOST = 2_000;
const FIND_DAYS = 5;

async function ownerOf(
  ports: ReadPorts,
  caller: Caller,
  input: TurnAddress,
): Promise<Owner | Refused> {
  const context = recordContext(ports, caller, ports.clock.now());
  return ports.store.transaction(async (tx) => {
    const scene = await turnSceneOf(tx, ports, context, caller, input);
    if ('status' in scene) return scene;
    const { harnessId, personId } = scene.request;
    const settings = await tx.assistantSettings.read.byHarness(harnessId);
    return {
      personId,
      harnessId,
      timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
      at: context.at,
    };
  });
}

function spanOf(owner: Owner, day: string | undefined, days: number): Span {
  const first = day ?? zonedDateOf(owner.at, owner.timezone);
  return {
    day: first,
    days,
    from: zonedInstant(first, 0, owner.timezone),
    to: zonedInstant(daysAfterDate(first, days), 0, owner.timezone),
  };
}

function whenOf(startsAt: Date, endsAt: Date, timezone: string): string {
  const start = formatZonedMinute(startsAt, timezone);
  const end = formatZonedMinute(endsAt, timezone);
  const [startDate] = start.split(' ');
  const [endDate, endTime] = end.split(' ');
  return startDate === endDate ? `${start} to ${endTime ?? ''}` : `${start} to ${end}`;
}

function detailsOf(entry: CalendarEntry): string {
  const lines = [`Title: ${entry.title}`];
  if (entry.location !== '') lines.push(`Location: ${entry.location}`);
  if (entry.description !== '') {
    lines.push(`Description: ${entry.description.slice(0, DESCRIPTION_MOST)}`);
  }
  return renderUntrusted(
    untrusted({ source: 'calendar_event', itemId: null, text: lines.join('\n') }),
  );
}

function eventOf(owner: Owner, entry: CalendarEntry): CalendarEvent {
  const own = entry.hold !== null && entry.hold.harnessId === owner.harnessId;
  return {
    startAt: entry.startsAt.toISOString(),
    endAt: entry.endsAt.toISOString(),
    when: entry.allDay
      ? `${zonedDateOf(entry.startsAt, owner.timezone)} all day`
      : whenOf(entry.startsAt, entry.endsAt, owner.timezone),
    allDay: entry.allDay,
    organisedByYou: entry.organisedBySelf,
    attendees: entry.attendees,
    holdId: own && entry.hold !== null ? entry.hold.holdId : null,
    details: detailsOf(entry),
  };
}

export async function readMyCalendar(
  ports: ReadPorts,
  caller: Caller,
  input: ReadCalendarInput,
): Promise<KernelOutcome<CalendarRead>> {
  const parsed = verbIo.read_my_calendar.input.safeParse({ day: input.day, days: input.days });
  if (!parsed.success || !addressed(input)) {
    return refused('malformed_command', { why: 'calendar_input' });
  }
  const owner = await ownerOf(ports, caller, input);
  if ('status' in owner) return owner;
  const span = spanOf(owner, parsed.data.day, parsed.data.days ?? 1);
  const window = { personId: owner.personId, from: span.from, to: span.to };
  const listed = await askCalendar(() => ports.workspace.listEvents(window));
  if (listed === 'not_wired' || listed.outcome !== 'listed') {
    return calendarRefusal(listed === 'not_wired' ? listed : listed.outcome);
  }
  return accepted({
    timezone: owner.timezone,
    from: span.from.toISOString(),
    to: span.to.toISOString(),
    events: listed.entries.map((entry) => eventOf(owner, entry)),
    truncated: listed.truncated,
  });
}

function slotsOf(owner: Owner, slots: ReturnType<typeof freeSlots>): FreeTime['slots'] {
  return slots.map((slot) => ({
    startAt: slot.startsAt.toISOString(),
    endAt: slot.endsAt.toISOString(),
    when: whenOf(slot.startsAt, slot.endsAt, owner.timezone),
  }));
}

export async function findFreeTime(
  ports: ReadPorts,
  caller: Caller,
  input: FindTimeInput,
): Promise<KernelOutcome<FreeTime>> {
  const { with: colleagues, minutes, day, days } = input;
  const parsed = verbIo.find_free_time.input.safeParse({ with: colleagues, minutes, day, days });
  if (!parsed.success || !addressed(input)) {
    return refused('malformed_command', { why: 'calendar_input' });
  }
  const owner = await ownerOf(ports, caller, input);
  if ('status' in owner) return owner;
  const span = spanOf(owner, parsed.data.day, parsed.data.days ?? FIND_DAYS);
  const addresses = [...new Set(parsed.data.with.map((email) => email.toLowerCase()))];
  const query = { personId: owner.personId, colleagues: addresses, from: span.from, to: span.to };
  const answer = await askCalendar(() => ports.workspace.freeBusy(query));
  if (answer !== 'not_wired' && answer.outcome === 'outside_organization') {
    return refused('not_permitted', { why: 'outside_organization', addresses: answer.addresses });
  }
  if (answer === 'not_wired' || answer.outcome !== 'answered') {
    return calendarRefusal(answer === 'not_wired' ? answer : answer.outcome);
  }
  const slots = freeSlots({
    busy: answer.busy,
    firstDay: span.day,
    days: span.days,
    timezone: owner.timezone,
    minutes: parsed.data.minutes,
    notBefore: owner.at,
  });
  return accepted({
    timezone: owner.timezone,
    slots: slotsOf(owner, slots),
    unknown: answer.unknown,
  });
}
