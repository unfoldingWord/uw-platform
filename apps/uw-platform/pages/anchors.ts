import { QUOTE_CONTEXT_LENGTH, type TextAnchor } from '@uw/contracts';

export type Resolution =
  | { readonly kind: 'anchored'; readonly start: number; readonly end: number }
  | { readonly kind: 'orphaned'; readonly why: 'missing' | 'ambiguous' };

export function anchorOf(text: string, start: number, end: number): TextAnchor {
  return {
    start,
    end,
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - QUOTE_CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + QUOTE_CONTEXT_LENGTH),
  };
}

function holdsAt(text: string, anchor: TextAnchor, start: number): boolean {
  const end = start + anchor.exact.length;
  return (
    start >= anchor.prefix.length &&
    text.slice(start, end) === anchor.exact &&
    text.slice(start - anchor.prefix.length, start) === anchor.prefix &&
    text.slice(end, end + anchor.suffix.length) === anchor.suffix
  );
}

function startsOf(text: string, needle: string): number[] {
  const found: number[] = [];
  if (needle === '') return found;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

function single(starts: readonly number[], length: number): Resolution | null {
  const [only, second] = starts;
  if (only === undefined) return null;
  if (second !== undefined) return { kind: 'orphaned', why: 'ambiguous' };
  return { kind: 'anchored', start: only, end: only + length };
}

function spansItsQuote(anchor: TextAnchor): boolean {
  return anchor.end - anchor.start === anchor.exact.length;
}

export function resolveAnchor(text: string, anchor: TextAnchor): Resolution {
  if (!spansItsQuote(anchor)) return { kind: 'orphaned', why: 'missing' };
  const end = anchor.start + anchor.exact.length;
  if (end <= text.length && holdsAt(text, anchor, anchor.start)) {
    return { kind: 'anchored', start: anchor.start, end };
  }
  const quoted = `${anchor.prefix}${anchor.exact}${anchor.suffix}`;
  const inContext = startsOf(text, quoted).map((at) => at + anchor.prefix.length);
  const byContext = single(inContext, anchor.exact.length);
  if (byContext !== null) return byContext;
  const byQuote = single(startsOf(text, anchor.exact), anchor.exact.length);
  return byQuote ?? { kind: 'orphaned', why: 'missing' };
}
