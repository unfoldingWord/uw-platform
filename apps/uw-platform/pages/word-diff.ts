import { diffWordsWithSpace } from 'diff';
import type { SuggestedChangeInput } from '@uw/contracts';
import { anchorOf } from './anchors.ts';

export type WordChange = {
  readonly kind: 'same' | 'added' | 'removed';
  readonly text: string;
};

const MOST_EDITS = 4_000;

export function wordChanges(before: string, after: string): WordChange[] | null {
  const pieces = diffWordsWithSpace(before, after, { maxEditLength: MOST_EDITS });
  if (pieces === undefined) return null;
  return pieces
    .filter((piece) => piece.value !== '')
    .map((piece) => ({
      kind: piece.added ? 'added' : piece.removed ? 'removed' : 'same',
      text: piece.value,
    }));
}

type Run = { readonly start: number; removed: string; added: string };

function changeOf(before: string, run: Run): SuggestedChangeInput {
  const anchor = anchorOf(before, run.start, run.start + run.removed.length);
  if (run.removed === '') return { kind: 'insertion', anchor, text: run.added, note: null };
  if (run.added === '') return { kind: 'deletion', anchor, text: '', note: null };
  return { kind: 'replacement', anchor, text: run.added, note: null };
}

function wholeChange(before: string, after: string): SuggestedChangeInput[] {
  return before === after ? [] : [changeOf(before, { start: 0, removed: before, added: after })];
}

export function suggestedChangesBetween(before: string, after: string): SuggestedChangeInput[] {
  const pieces = wordChanges(before, after);
  if (pieces === null) return wholeChange(before, after);
  const changes: SuggestedChangeInput[] = [];
  let at = 0;
  let run: Run | null = null;
  for (const piece of pieces) {
    if (piece.kind === 'same') {
      if (run !== null) changes.push(changeOf(before, run));
      run = null;
      at += piece.text.length;
      continue;
    }
    run ??= { start: at, removed: '', added: '' };
    if (piece.kind === 'removed') run.removed += piece.text;
    else run.added += piece.text;
    if (piece.kind === 'removed') at += piece.text.length;
  }
  if (run !== null) changes.push(changeOf(before, run));
  return changes;
}
