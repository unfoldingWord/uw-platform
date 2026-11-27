import type { SuggestedChangeInput } from '@uw/contracts';

type Span = { readonly start: number; readonly end: number };

function spanOf(change: SuggestedChangeInput): Span {
  return { start: change.anchor.start, end: change.anchor.end };
}

function overlaps(left: Span, right: Span): boolean {
  const leftPoint = left.start === left.end;
  const rightPoint = right.start === right.end;
  if (leftPoint && rightPoint) return left.start === right.start;
  if (leftPoint) return right.start < left.start && left.start < right.end;
  if (rightPoint) return left.start < right.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

export function overlapping(changes: readonly SuggestedChangeInput[]): readonly number[] {
  const spans = changes.map(spanOf);
  return spans.flatMap((span, index) =>
    spans.slice(0, index).some((earlier) => overlaps(earlier, span)) ? [index] : [],
  );
}

export function inTextOrder<T extends SuggestedChangeInput>(changes: readonly T[]): T[] {
  return [...changes].sort(
    (left, right) => left.anchor.start - right.anchor.start || left.anchor.end - right.anchor.end,
  );
}

export function applyChanges(body: string, changes: readonly SuggestedChangeInput[]): string {
  const edits = inTextOrder(changes.filter((change) => change.kind !== 'comment'));
  let at = 0;
  let out = '';
  for (const edit of edits) {
    out += body.slice(at, edit.anchor.start) + edit.text;
    at = edit.anchor.end;
  }
  return out + body.slice(at);
}
