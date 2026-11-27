import { z } from 'zod';

export const isoDateSchema = z.iso.date().brand<'IsoDate'>();

export type IsoDate = z.infer<typeof isoDateSchema>;

const LARGEST_FOUR_DIGIT_YEAR = 9999;

export function formatDate(instant: Date): IsoDate {
  const year = instant.getUTCFullYear();
  if (Number.isNaN(year) || year < 0 || year > LARGEST_FOUR_DIGIT_YEAR) {
    throw new RangeError('formatDate needs a valid instant with a four-digit year');
  }
  return isoDateSchema.parse(instant.toISOString().slice(0, 10));
}

export function parseDate(text: string): Date {
  const parsed = isoDateSchema.safeParse(text);
  if (!parsed.success) {
    throw new RangeError(`parseDate accepts only YYYY-MM-DD, got ${JSON.stringify(text)}`);
  }
  return new Date(`${parsed.data}T00:00:00.000Z`);
}

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_HOURS = 24;

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatInstant(instant: Date): string {
  const time = `${twoDigits(instant.getUTCHours())}:${twoDigits(instant.getUTCMinutes())}`;
  return `${formatDate(instant)} ${time} UTC`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE_MS));
  const hours = Math.floor(minutes / HOUR_MINUTES);
  if (hours === 0) return `${minutes} min`;
  const days = Math.floor(hours / DAY_HOURS);
  if (days === 0) return `${hours} h ${minutes % HOUR_MINUTES} min`;
  return `${days} d ${hours % DAY_HOURS} h`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function formatMonth(month: string): string {
  const first = parseDate(`${month}-01`);
  return `${MONTH_NAMES[first.getUTCMonth()] ?? ''} ${first.getUTCFullYear()}`;
}

export function yearsAfter(instant: Date, years: number): Date {
  const moved = new Date(instant.getTime());
  moved.setUTCFullYear(instant.getUTCFullYear() + years);
  if (moved.getUTCMonth() !== instant.getUTCMonth()) moved.setUTCDate(0);
  return moved;
}

const FIXED_OFFSET_ZONE = /^(?:[+\-\u2212]|(?:etc\/)?(?:gmt|utc)[+\-\u2212])/i;

function fixedOffset(name: string): boolean {
  return FIXED_OFFSET_ZONE.test(name.trim());
}

export function knownTimeZone(name: string): boolean {
  if (fixedOffset(name)) return false;
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone;
    return resolved !== '' && !fixedOffset(resolved);
  } catch {
    return false;
  }
}

type WallTime = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

const DAY_MS = DAY_HOURS * HOUR_MINUTES * MINUTE_MS;

function zoneOrUtc(timeZone: string): string {
  return knownTimeZone(timeZone) ? timeZone : 'UTC';
}

function wallTimeOf(instant: Date, timeZone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zoneOrUtc(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value ?? '0');
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour') % DAY_HOURS,
    minute: part('minute'),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const wall = wallTimeOf(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const truncated = Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
  return asUtc - truncated;
}

export function zonedDateOf(instant: Date, timeZone: string): IsoDate {
  const wall = wallTimeOf(instant, timeZone);
  return formatDate(new Date(Date.UTC(wall.year, wall.month - 1, wall.day)));
}

export function zonedInstant(day: string, minuteOfDay: number, timeZone: string): Date {
  const guess = parseDate(day).getTime() + minuteOfDay * MINUTE_MS;
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

export function formatZonedMinute(instant: Date, timeZone: string): string {
  const wall = wallTimeOf(instant, timeZone);
  const date = formatDate(new Date(Date.UTC(wall.year, wall.month - 1, wall.day)));
  return `${date} ${twoDigits(wall.hour)}:${twoDigits(wall.minute)}`;
}

export function daysAfterDate(day: string, days: number): IsoDate {
  return formatDate(new Date(parseDate(day).getTime() + days * DAY_MS));
}

export function weekdayOfDate(day: string): number {
  return parseDate(day).getUTCDay();
}
