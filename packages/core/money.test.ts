import { describe, expect, it } from 'vitest';
import { formatCount, formatMoney } from './money.ts';

describe('WB-11 money is formatted once from integer minor units', () => {
  it('WB-11 formats US dollars with grouping and two decimals', () => {
    expect(formatMoney({ amountMinor: 125000, currency: 'USD' })).toBe('$1,250.00');
  });

  it('WB-11 uses the currency own minor-unit exponent', () => {
    expect(formatMoney({ amountMinor: 5, currency: 'JPY' })).toBe('¥5');
    expect(formatMoney({ amountMinor: 5, currency: 'USD' })).toBe('$0.05');
  });

  it('WB-11 formats a three-decimal currency and a negative zero-decimal one', () => {
    expect(formatMoney({ amountMinor: 1234567, currency: 'BHD' })).toBe('BHD\u00a01,234.567');
    expect(formatMoney({ amountMinor: -1, currency: 'BHD' })).toBe('-BHD\u00a00.001');
    expect(formatMoney({ amountMinor: -5, currency: 'JPY' })).toBe('-¥5');
  });

  it('WB-11 formats a negative amount and zero without a negative zero', () => {
    expect(formatMoney({ amountMinor: -125000, currency: 'USD' })).toBe('-$1,250.00');
    expect(formatMoney({ amountMinor: -5, currency: 'USD' })).toBe('-$0.05');
    expect(formatMoney({ amountMinor: 0, currency: 'USD' })).toBe('$0.00');
    expect(formatMoney({ amountMinor: -0, currency: 'USD' })).toBe('$0.00');
  });

  it('WB-11 is exact at the largest safe integer, where floating-point division is not', () => {
    expect(formatMoney({ amountMinor: Number.MAX_SAFE_INTEGER, currency: 'USD' })).toBe(
      '$90,071,992,547,409.91',
    );
    expect(formatMoney({ amountMinor: Number.MIN_SAFE_INTEGER, currency: 'USD' })).toBe(
      '-$90,071,992,547,409.91',
    );
    expect(formatMoney({ amountMinor: 1, currency: 'USD' })).toBe('$0.01');
    expect(formatMoney({ amountMinor: 1005, currency: 'USD' })).toBe('$10.05');
  });

  it('WB-11 refuses a fraction, a non-finite number or an unsafe integer with a RangeError', () => {
    for (const amountMinor of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => formatMoney({ amountMinor, currency: 'USD' })).toThrow(RangeError);
    }
  });

  it('WB-11 refuses a currency outside three capital letters', () => {
    for (const currency of ['usd', 'US', 'USDD', '', 'U$D']) {
      expect(() => formatMoney({ amountMinor: 1, currency })).toThrow(RangeError);
    }
  });
});

describe('formatCount', () => {
  it('formatCount groups digits', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(-4200)).toBe('-4,200');
  });
});
