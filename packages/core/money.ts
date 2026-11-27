const currencyPattern = /^[A-Z]{3}$/;

export type Money = { readonly amountMinor: number; readonly currency: string };

function decimalText(amountMinor: number, digits: number): string {
  const scale = 10 ** digits;
  const magnitude = Math.abs(amountMinor);
  const remainder = magnitude % scale;
  const whole = (magnitude - remainder) / scale;
  const fraction = String(remainder).padStart(digits, '0');
  const sign = amountMinor < 0 ? '-' : '';
  return digits === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

export function formatMoney(money: Money): string {
  if (!Number.isSafeInteger(money.amountMinor)) {
    throw new RangeError('money is an integer count of minor units');
  }
  if (!currencyPattern.test(money.currency)) throw new RangeError('a currency is an ISO 4217 code');
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(decimalText(money.amountMinor, digits) as `${number}`);
}

const wholePattern = /^\d{1,12}$/;
const fractionPattern = /^\d{0,6}$/;

function fractionDigitsOf(currency: string): number | null {
  try {
    const format = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    return format.resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

export function parseMoney(amount: string, currency: string): Money | null {
  const [whole = '', fraction = '', extra] = amount.split('.');
  if (extra !== undefined || !wholePattern.test(whole) || !fractionPattern.test(fraction)) {
    return null;
  }
  if (!currencyPattern.test(currency)) return null;
  const digits = fractionDigitsOf(currency);
  if (digits === null || /[1-9]/.test(fraction.slice(digits))) return null;
  const minor = `${whole}${fraction.slice(0, digits).padEnd(digits, '0')}`;
  return { amountMinor: Number.parseInt(minor, 10), currency };
}

const counts = new Intl.NumberFormat('en-US');

export function formatCount(count: number): string {
  return counts.format(count);
}
