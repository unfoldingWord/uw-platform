const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function digit(text: string, index: number, fallback: number): number {
  const char = text.charAt(index);
  return char === '' ? fallback : DIGITS.indexOf(char);
}

function sharedPrefix(low: string, high: string): number {
  let n = 0;
  while (n < high.length && (low.charAt(n) || '0') === high.charAt(n)) n += 1;
  return n;
}

function midpoint(low: string, high: string | null): string {
  if (high !== null) {
    const n = sharedPrefix(low, high);
    if (n > 0) return high.slice(0, n) + midpoint(low.slice(n), high.slice(n));
  }
  const a = digit(low, 0, 0);
  const b = high === null ? DIGITS.length : digit(high, 0, DIGITS.length);
  if (b - a > 1) return DIGITS.charAt(Math.round((a + b) / 2));
  if (high !== null && high.length > 1) return high.slice(0, 1);
  return DIGITS.charAt(a) + midpoint(low.slice(1), null);
}

export function keyBetween(low: string | null, high: string | null): string {
  if (low !== null && high !== null && low >= high) {
    throw new RangeError('a key goes between a lower and a higher key');
  }
  return midpoint(low ?? '', high);
}
