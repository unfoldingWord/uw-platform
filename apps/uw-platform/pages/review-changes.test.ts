import { describe, expect, it } from 'vitest';
import type { SuggestedChangeInput } from '@uw/contracts';
import { anchorOf } from './anchors.ts';
import { applyChanges, overlapping } from './review-changes.ts';

const body = 'Two adults are present.';

function change(
  kind: SuggestedChangeInput['kind'],
  span: readonly [number, number],
  text = '',
  note: string | null = null,
): SuggestedChangeInput {
  return { kind, anchor: anchorOf(body, span[0], span[1]), text, note };
}

describe('#197 a review set applies its suggested changes to the base text', () => {
  it('applies insertions, deletions and replacements, and leaves comments out of the text', () => {
    const changes = [
      change('replacement', [0, 3], 'Three'),
      change('insertion', [4, 4], 'trained '),
      change('deletion', [14, 22]),
      change('comment', [4, 10], '', 'Who counts as an adult?'),
    ];
    expect(applyChanges(body, changes.slice(0, 3))).toBe('Three trained adults are.');
    expect(applyChanges(body, [changes[3] ?? change('deletion', [0, 1])])).toBe(body);
  });

  it('finds changes that overlap an earlier one, and lets adjacent ones stand', () => {
    const changes = [
      change('replacement', [4, 10], 'people'),
      change('insertion', [4, 4], 'two '),
      change('deletion', [10, 14]),
      change('comment', [6, 12], '', 'Overlaps both.'),
      change('insertion', [4, 4], 'more '),
    ];
    expect(overlapping(changes)).toEqual([3, 4]);
  });
});
