import type { SuggestedChangeInput } from '@uw/contracts';
import { anchorOf } from '../pages/anchors.ts';
import { inTextOrder } from '../pages/review-changes.ts';
import { canonicalJson, sha256Hex } from '../pdf/provenance.ts';

export type ParsedMarks = {
  readonly original: string;
  readonly changes: readonly SuggestedChangeInput[];
};

const INSERT = '{++';
const DELETE = '{--';
const REPLACE = '{~~';
const HIGHLIGHT = '{==';
const NOTE = '{>>';
const BECOMES = '~>';

const closerOf: ReadonlyMap<string, string> = new Map([
  [INSERT, '++}'],
  [DELETE, '--}'],
  [REPLACE, '~~}'],
  [HIGHLIGHT, '==}'],
  [NOTE, '<<}'],
]);

const OPENERS: readonly string[] = [...closerOf.keys()];

const tokens = (): RegExp => /(\\*)(\{\+\+|\{--|\{~~|\{==|\{>>|\+\+\}|--\}|~~\}|==\}|<<\}|~>)/g;

const TRAILING_SLASHES = /\\+$/;

function escaped(text: string, beforeMark: boolean): string {
  const inner = text.replace(tokens(), (_, slashes: string, token: string) => {
    return `${slashes}${slashes}\\${token}`;
  });
  if (!beforeMark) return inner;
  return inner + (TRAILING_SLASHES.exec(inner)?.[0] ?? '');
}

function wrapped(opener: string, text: string): string {
  return `${opener}${escaped(text, true)}${closerOf.get(opener) ?? ''}`;
}

function noteMark(note: string | null): string {
  return note === null ? '' : wrapped(NOTE, note);
}

function markOf(change: SuggestedChangeInput, afterBareMark: boolean): string {
  const { kind, anchor, text, note } = change;
  if (kind === 'insertion') return `${wrapped(INSERT, text)}${noteMark(note)}`;
  if (kind === 'deletion') return `${wrapped(DELETE, anchor.exact)}${noteMark(note)}`;
  if (kind === 'replacement') {
    const swap = `${REPLACE}${escaped(anchor.exact, true)}${BECOMES}${escaped(text, true)}~~}`;
    return `${swap}${noteMark(note)}`;
  }
  const pointOnly = anchor.exact === '' && !afterBareMark;
  return pointOnly ? noteMark(note) : `${wrapped(HIGHLIGHT, anchor.exact)}${noteMark(note)}`;
}

export function markedText(body: string, changes: readonly SuggestedChangeInput[]): string {
  let at = 0;
  let out = '';
  let bareMarkEnd = -1;
  for (const change of inTextOrder(changes)) {
    const afterBareMark = bareMarkEnd === change.anchor.start && at === change.anchor.start;
    out += escaped(body.slice(at, change.anchor.start), true) + markOf(change, afterBareMark);
    at = change.anchor.end;
    bareMarkEnd = change.note === null ? change.anchor.end : -1;
  }
  return out + escaped(body.slice(at), false);
}

type Scanned = {
  readonly content: string;
  readonly token: string | null;
  readonly tokenAt: number;
  readonly next: number;
};

function scanUntil(text: string, from: number, wanted: readonly string[]): Scanned {
  const pattern = tokens();
  pattern.lastIndex = from;
  let content = '';
  let kept = from;
  for (let found = pattern.exec(text); found !== null; found = pattern.exec(text)) {
    const [whole, slashes = '', token = ''] = found;
    const half = '\\'.repeat(Math.floor(slashes.length / 2));
    content += text.slice(kept, found.index) + half;
    kept = found.index + whole.length;
    const literal = slashes.length % 2 === 1 || !wanted.includes(token);
    if (!literal) {
      return { content, token, tokenAt: found.index + slashes.length, next: kept };
    }
    content += token;
  }
  content += text.slice(kept);
  return { content, token: null, tokenAt: text.length, next: text.length };
}

type Found = {
  readonly kind: SuggestedChangeInput['kind'] | 'highlight';
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly note: string | null;
  readonly closesAt: number;
};

type Reading = { original: string; readonly found: Found[] };

type Mark = {
  readonly opener: string;
  readonly openedAt: number;
  readonly parts: readonly string[];
  readonly closesAt: number;
};

function placed(reading: Reading, mark: Mark, kept: string) {
  const start = reading.original.length;
  reading.original += kept;
  return { start, end: start + kept.length, closesAt: mark.closesAt };
}

function comment(reading: Reading, mark: Mark, note: string): void {
  const last = reading.found.at(-1);
  if (last !== undefined && last.closesAt === mark.openedAt && last.note === null) {
    reading.found[reading.found.length - 1] = {
      ...last,
      kind: last.kind === 'highlight' ? 'comment' : last.kind,
      note,
      closesAt: mark.closesAt,
    };
    return;
  }
  reading.found.push({ kind: 'comment', ...placed(reading, mark, ''), text: '', note });
}

function read(reading: Reading, mark: Mark): void {
  const [first = '', second = ''] = mark.parts;
  if (mark.opener === NOTE) return comment(reading, mark, first);
  if (mark.opener === INSERT) {
    reading.found.push({
      kind: 'insertion',
      ...placed(reading, mark, ''),
      text: first,
      note: null,
    });
  } else if (mark.opener === DELETE) {
    reading.found.push({ kind: 'deletion', ...placed(reading, mark, first), text: '', note: null });
  } else if (mark.opener === REPLACE) {
    const at = placed(reading, mark, first);
    reading.found.push({ kind: 'replacement', ...at, text: second, note: null });
  } else {
    reading.found.push({
      kind: 'highlight',
      ...placed(reading, mark, first),
      text: '',
      note: null,
    });
  }
}

function markFrom(text: string, opened: Scanned): Mark | null {
  const opener = opened.token ?? '';
  const closer = closerOf.get(opener) ?? '';
  const wantsSwap = opener === REPLACE;
  const first = scanUntil(text, opened.next, [wantsSwap ? BECOMES : closer]);
  if (first.token === null) return null;
  const second = wantsSwap ? scanUntil(text, first.next, [closer]) : null;
  if (second?.token === null) return null;
  const parts = second === null ? [first.content] : [first.content, second.content];
  return { opener, openedAt: opened.tokenAt, parts, closesAt: (second ?? first).next };
}

function readAll(text: string): Reading {
  const reading: Reading = { original: '', found: [] };
  let at = 0;
  for (;;) {
    const plain = scanUntil(text, at, OPENERS);
    reading.original += plain.content;
    if (plain.token === null) return reading;
    const mark = markFrom(text, plain);
    if (mark === null) {
      reading.original += plain.token + scanUntil(text, plain.next, []).content;
      return reading;
    }
    read(reading, mark);
    at = mark.closesAt;
  }
}

export function parseMarked(text: string): ParsedMarks {
  const { original, found } = readAll(text);
  const changes = found.flatMap((mark): SuggestedChangeInput[] =>
    mark.kind === 'highlight'
      ? []
      : [
          {
            kind: mark.kind,
            anchor: anchorOf(original, mark.start, mark.end),
            text: mark.text,
            note: mark.note,
          },
        ],
  );
  return { original, changes };
}

export function changesHash(changes: readonly SuggestedChangeInput[]): Promise<string> {
  const canonical = inTextOrder(changes).map(({ kind, anchor, text, note }) => ({
    kind,
    anchor,
    text,
    note,
  }));
  return sha256Hex(canonicalJson(canonical));
}
