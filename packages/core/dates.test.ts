import { describe, expect, it } from 'vitest';
import { formatDate, isoDateSchema, parseDate } from './dates.ts';

describe('formatDate', () => {
  it('renders the UTC calendar date as an ISO 8601 date', () => {
    expect(formatDate(new Date(Date.UTC(2026, 2, 3, 23, 59)))).toBe('2026-03-03');
  });

  it('pads single-digit months and days', () => {
    expect(formatDate(new Date(Date.UTC(2026, 0, 9)))).toBe('2026-01-09');
  });

  it('refuses an invalid instant', () => {
    expect(() => formatDate(new Date(Number.NaN))).toThrow(RangeError);
  });

  it('refuses a year that does not fit four digits', () => {
    expect(() => formatDate(new Date(Date.UTC(10000, 0, 1)))).toThrow(RangeError);
  });
});

describe('parseDate', () => {
  it('reads an ISO 8601 date as midnight UTC', () => {
    expect(parseDate('2026-03-03').toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });

  it('round-trips through formatDate', () => {
    expect(formatDate(parseDate('2024-02-29'))).toBe('2024-02-29');
  });

  it.each(['03/03/2026', '12/31/2026', '2026-3-3', 'March 3, 2026', '2026-03-03T00:00:00Z', '', ' 2026-03-03'])(
    'rejects %j',
    (text) => {
      expect(() => parseDate(text)).toThrow(RangeError);
    },
  );

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-00-10'])('rejects the impossible date %j', (text) => {
    expect(() => parseDate(text)).toThrow(RangeError);
  });
});

describe('isoDateSchema', () => {
  it('accepts an ISO calendar date', () => {
    expect(isoDateSchema.safeParse('2026-03-03').success).toBe(true);
  });

  it.each(['2026-3-3', '03/03/2026', 'March 3, 2026'])('rejects %j', (text) => {
    expect(isoDateSchema.safeParse(text).success).toBe(false);
  });
});
