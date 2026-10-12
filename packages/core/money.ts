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

const counts = new Intl.NumberFormat('en-US');

export function formatCount(count: number): string {
  return counts.format(count);
}
