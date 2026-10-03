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
