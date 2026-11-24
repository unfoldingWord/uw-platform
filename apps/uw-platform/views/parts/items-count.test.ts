import { describe, expect, it } from 'vitest';
import { itemsText } from './items-count.ts';

function column(cards: number, uncounted: number, next: string | null) {
  return { cards: Array.from({ length: cards }, (_, index) => index), next, uncounted };
}

describe('OB-4 the Board column count', () => {
  it('OB-4 counts every card when no bot pull request is on it', () => {
    expect(itemsText(column(3, 0, null), ['dependabot[bot]'])).toBe('3');
    expect(itemsText(column(50, 0, 'cursor'), ['dependabot[bot]'])).toBe('50 or more');
  });

  it('OB-4 says what it left out, on a whole column and on a column with more pages', () => {
    expect(itemsText(column(5, 2, null), ['dependabot[bot]'])).toBe(
      '3, not counting 2 by dependabot[bot]',
    );
    expect(itemsText(column(50, 2, 'cursor'), ['dependabot[bot]', 'renovate[bot]'])).toBe(
      '48 or more, not counting at least 2 by dependabot[bot], renovate[bot]',
    );
  });
});
