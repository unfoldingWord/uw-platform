import { daysAfterDate, weekdayOfDate, zonedInstant } from '@uw/core/dates';
import type { BusyRange } from '../ports.ts';

export type FreeSlot = { readonly startsAt: Date; readonly endsAt: Date };
export type SlotQuery = {
  readonly busy: readonly BusyRange[];
  readonly firstDay: string;
  readonly days: number;
  readonly timezone: string;
  readonly minutes: number;
  readonly notBefore: Date;
};

const WORKDAY_START_MINUTE = 9 * 60;
const WORKDAY_END_MINUTE = 17 * 60;
const SLOTS_MOST = 10;
const STEP_MS = 15 * 60_000;
const MINUTE_MS = 60_000;
const SATURDAY = 6;
const SUNDAY = 0;

function roundedUp(at: number): number {
  return Math.ceil(at / STEP_MS) * STEP_MS;
}

function slotsInDay(query: SlotQuery, day: string, sorted: readonly BusyRange[]): FreeSlot[] {
  const opens = zonedInstant(day, WORKDAY_START_MINUTE, query.timezone).getTime();
  const closes = zonedInstant(day, WORKDAY_END_MINUTE, query.timezone).getTime();
  const length = query.minutes * MINUTE_MS;
  const slots: FreeSlot[] = [];
  let cursor = roundedUp(Math.max(opens, query.notBefore.getTime()));
  for (const range of sorted) {
    const starts = range.startsAt.getTime();
    if (range.endsAt.getTime() <= cursor || starts >= closes) continue;
    if (starts - cursor >= length) slots.push(slotAt(cursor, length));
    cursor = roundedUp(Math.max(cursor, range.endsAt.getTime()));
  }
  if (closes - cursor >= length) slots.push(slotAt(cursor, length));
  return slots;
}

function slotAt(start: number, length: number): FreeSlot {
  return { startsAt: new Date(start), endsAt: new Date(start + length) };
}

function workday(day: string): boolean {
  const weekday = weekdayOfDate(day);
  return weekday !== SATURDAY && weekday !== SUNDAY;
}

export function freeSlots(query: SlotQuery): readonly FreeSlot[] {
  const sorted = [...query.busy].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const slots: FreeSlot[] = [];
  for (let n = 0; n < query.days && slots.length < SLOTS_MOST; n += 1) {
    const day = daysAfterDate(query.firstDay, n);
    if (workday(day)) slots.push(...slotsInDay(query, day, sorted));
  }
  return slots.slice(0, SLOTS_MOST);
}
