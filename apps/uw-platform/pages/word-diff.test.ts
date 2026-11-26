import { describe, expect, it } from 'vitest';
import { applyChanges } from './review-changes.ts';
import { suggestedChangesBetween, wordChanges } from './word-diff.ts';

const before = 'Two adults are present at every session.\n\nRecords are kept.';
const after = 'Two named adults are present at each session.\n\nRecords are kept.';

describe('#197 two texts are compared word by word', () => {
  it('marks the words that differ and keeps the rest as they are', () => {
    expect(wordChanges(before, after)).toEqual([
      { kind: 'same', text: 'Two ' },
      { kind: 'added', text: 'named ' },
      { kind: 'same', text: 'adults are present at ' },
      { kind: 'removed', text: 'every' },
      { kind: 'added', text: 'each' },
      { kind: 'same', text: ' session.\n\nRecords are kept.' },
    ]);
  });

  it('turns the difference into suggested changes anchored in the base text', () => {
    const changes = suggestedChangesBetween(before, after);
    expect(changes.map(({ kind, anchor, text }) => [kind, anchor.exact, text])).toEqual([
      ['insertion', '', 'named '],
      ['replacement', 'every', 'each'],
    ]);
    expect(changes[1]?.anchor).toMatchObject({ start: 26, end: 31, prefix: before.slice(0, 26) });
    expect(applyChanges(before, changes)).toBe(after);
  });

  it('suggests nothing for the same text, and a deletion when words are dropped', () => {
    expect(suggestedChangesBetween(before, before)).toEqual([]);
    const dropped = suggestedChangesBetween('Keep this. Drop this.', 'Keep this.');
    expect(dropped.map(({ kind, anchor }) => [kind, anchor.exact])).toEqual([
      ['deletion', ' Drop this.'],
    ]);
  });
});
