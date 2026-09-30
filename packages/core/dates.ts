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
