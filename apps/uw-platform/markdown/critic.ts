import type { SuggestedChangeInput } from '@uw/contracts';
import { anchorOf } from '../pages/anchors.ts';
import { inTextOrder } from '../pages/review-changes.ts';

export type ParsedMarks = {
  readonly original: string;
  readonly changes: readonly SuggestedChangeInput[];
};

function noteMark(note: string | null): string {
  return note === null ? '' : `{>>${note}<<}`;
}

function markOf(change: SuggestedChangeInput): string {
  const { kind, anchor, text, note } = change;
  if (kind === 'insertion') return `{++${text}++}${noteMark(note)}`;
  if (kind === 'deletion') return `{--${anchor.exact}--}${noteMark(note)}`;
  if (kind === 'replacement') return `{~~${anchor.exact}~>${text}~~}${noteMark(note)}`;
  return anchor.exact === '' ? noteMark(note) : `{==${anchor.exact}==}${noteMark(note)}`;
}

export function markedText(body: string, changes: readonly SuggestedChangeInput[]): string {
  let at = 0;
  let out = '';
  for (const change of inTextOrder(changes)) {
    out += body.slice(at, change.anchor.start) + markOf(change);
    at = change.anchor.end;
  }
  return out + body.slice(at);
}

const MARKS =
  /\{\+\+([\s\S]*?)\+\+\}|\{--([\s\S]*?)--\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}|\{==([\s\S]*?)==\}|\{>>([\s\S]*?)<<\}/g;

type Found = {
  readonly kind: SuggestedChangeInput['kind'] | 'highlight';
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly note: string | null;
  readonly closesAt: number;
};

type Reading = { original: string; readonly found: Found[] };

function placed(reading: Reading, match: RegExpExecArray, kept: string) {
  const start = reading.original.length;
  reading.original += kept;
  return { start, end: start + kept.length, closesAt: match.index + match[0].length };
}

function comment(reading: Reading, match: RegExpExecArray, note: string): void {
  const last = reading.found.at(-1);
  if (last !== undefined && last.closesAt === match.index && last.note === null) {
    reading.found[reading.found.length - 1] = {
      ...last,
      kind: last.kind === 'highlight' ? 'comment' : last.kind,
      note,
      closesAt: match.index + match[0].length,
    };
    return;
  }
  const at = placed(reading, match, '');
  reading.found.push({ kind: 'comment', ...at, text: '', note });
}

function read(reading: Reading, match: RegExpExecArray): void {
  const [, inserted, deleted, replaced, replacement, highlighted, note] = match;
  if (note !== undefined) return comment(reading, match, note);
  if (inserted !== undefined) {
    const at = placed(reading, match, '');
    reading.found.push({ kind: 'insertion', ...at, text: inserted, note: null });
  } else if (deleted !== undefined) {
    reading.found.push({
      kind: 'deletion',
      ...placed(reading, match, deleted),
      text: '',
      note: null,
    });
  } else if (replaced !== undefined) {
    const at = placed(reading, match, replaced);
    reading.found.push({ kind: 'replacement', ...at, text: replacement ?? '', note: null });
  } else {
    const at = placed(reading, match, highlighted ?? '');
    reading.found.push({ kind: 'highlight', ...at, text: '', note: null });
  }
}

export function parseMarked(text: string): ParsedMarks {
  const reading: Reading = { original: '', found: [] };
  let at = 0;
  for (const match of text.matchAll(MARKS)) {
    reading.original += text.slice(at, match.index);
    read(reading, match);
    at = match.index + match[0].length;
  }
  reading.original += text.slice(at);
  const { original } = reading;
  const changes = reading.found.flatMap((found): SuggestedChangeInput[] =>
    found.kind === 'highlight'
      ? []
      : [
          {
            kind: found.kind,
            anchor: anchorOf(original, found.start, found.end),
            text: found.text,
            note: found.note,
          },
        ],
  );
  return { original, changes };
}
