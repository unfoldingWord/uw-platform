import { describe, expect, it } from 'vitest';
import type { SuggestedChangeInput } from '@uw/contracts';
import { anchorOf } from '../pages/anchors.ts';
import { markedText, parseMarked } from './critic.ts';

const body = 'Two adults are present.\n\nRecords are kept for a year.';

function change(
  kind: SuggestedChangeInput['kind'],
  span: readonly [number, number],
  text = '',
  note: string | null = null,
): SuggestedChangeInput {
  return { kind, anchor: anchorOf(body, span[0], span[1]), text, note };
}

const changes: readonly SuggestedChangeInput[] = [
  change('insertion', [4, 4], 'trained ', 'Training is the point.'),
  change('comment', [4, 10], '', 'Who counts as an adult?'),
  change('replacement', [19, 22], 'here'),
  change('deletion', [41, 52]),
];

describe('#197 suggested changes are written as CriticMarkup and read back', () => {
  it('marks insertions, comments on a span, replacements and deletions', () => {
    expect(markedText(body, changes)).toBe(
      'Two {++trained ++}{>>Training is the point.<<}{==adults==}{>>Who counts as an adult?<<}' +
        ' are pres{~~ent~>here~~}.\n\nRecords are kept{-- for a year--}.',
    );
  });

  it('reads the marks back to the text under them and the same suggested changes', () => {
    const parsed = parseMarked(markedText(body, changes));
    expect(parsed.original).toBe(body);
    expect(parsed.changes).toEqual(changes);
  });

  it('reads a lone comment as a comment on a point, and plain text as no changes', () => {
    expect(parseMarked('Before{>>Why?<<} after.')).toEqual({
      original: 'Before after.',
      changes: [
        {
          kind: 'comment',
          anchor: { start: 6, end: 6, exact: '', prefix: 'Before', suffix: ' after.' },
          text: '',
          note: 'Why?',
        },
      ],
    });
    expect(parseMarked(body)).toEqual({ original: body, changes: [] });
  });
});

describe('#197 the marked format reads back exactly the text and the changes written', () => {
  it('keeps literal CriticMarkup in a page that has no suggestions', () => {
    const literal = 'Write {++draft++} or {--old--}, then {~~a~>b~~} and {>>a note<<} by hand.';
    const marked = markedText(literal, []);
    expect(parseMarked(marked)).toEqual({ original: literal, changes: [] });
  });

  it('keeps literal delimiters and backslashes inside and around suggested changes', () => {
    const tricky = 'Use \\{++ and ++} or ~> freely.\\';
    const around: readonly SuggestedChangeInput[] = [
      {
        kind: 'replacement',
        anchor: anchorOf(tricky, 4, 8),
        text: 'a --} and a ~~} \\',
        note: 'Keep <<} as typed.',
      },
      { kind: 'insertion', anchor: anchorOf(tricky, 9, 9), text: '{==x==}', note: null },
    ];
    const parsed = parseMarked(markedText(tricky, around));
    expect(parsed.original).toBe(tricky);
    expect(parsed.changes).toEqual(around);
  });

  it('keeps a deletion and a separate comment just after it as two changes', () => {
    const apart: readonly SuggestedChangeInput[] = [
      change('deletion', [41, 52]),
      change('comment', [52, 52], '', 'Say how long instead.'),
    ];
    const parsed = parseMarked(markedText(body, apart));
    expect(parsed.original).toBe(body);
    expect(parsed.changes).toEqual(apart);
  });

  it("reads a comment written straight after a mark as that mark's note", () => {
    const typed = 'Records are kept{-- for a year--}{>>Too long.<<}.';
    expect(parseMarked(typed).changes.map(({ kind, note }) => [kind, note])).toEqual([
      ['deletion', 'Too long.'],
    ]);
  });
});
