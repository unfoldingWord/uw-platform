export type Span = { readonly start: number; readonly end: number };
type Answer = Span | 'unsatisfiable' | null;

const ONE_RANGE = /^bytes=(\d*)-(\d*)$/;

function suffix(length: number, size: number): Span | 'unsatisfiable' {
  if (length === 0 || size === 0) return 'unsatisfiable';
  return { start: Math.max(0, size - length), end: size - 1 };
}

function fromStart(from: string, to: string, size: number): Span | 'unsatisfiable' {
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start >= size || end < start ? 'unsatisfiable' : { start, end };
}

function spanOf(from: string, to: string, size: number): Answer {
  if (from === '' && to === '') return null;
  return from === '' ? suffix(Number(to), size) : fromStart(from, to, size);
}

export function rangeOf(header: string | null, size: number): Answer {
  const found = header === null ? null : ONE_RANGE.exec(header.trim());
  return found === null ? null : spanOf(found[1] ?? '', found[2] ?? '', size);
}
