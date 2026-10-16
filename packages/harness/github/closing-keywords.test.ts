import { describe, expect, it } from 'vitest';
import { closingReferences, hasSkipCiMarker } from './closing-keywords.ts';

const here = 'unfoldingWord/uw-platform';

describe('SR-1 closing keywords, quoted or not, in a pull request body or a commit', () => {
  it('reads every GitHub closing keyword before #N, owner/name#N and an issue URL', () => {
    const body = [
      'Fixes #12',
      'closes: unfoldingWord/tc-admin-app#3',
      'Resolved https://github.com/unfoldingWord/uw-platform/issues/40',
      'fix #12 again',
    ].join('\n');
    expect(closingReferences(body, here)).toEqual([
      { repo: here, number: 12 },
      { repo: 'unfoldingWord/tc-admin-app', number: 3 },
      { repo: here, number: 40 },
    ]);
  });

  it('reads a keyword inside quotes or a code span', () => {
    expect(closingReferences('The bot wrote "Closes #7" here', here)).toEqual([
      { repo: here, number: 7 },
    ]);
    expect(closingReferences('Do not write `fixes #8` in a body', here)).toEqual([
      { repo: here, number: 8 },
    ]);
  });

  it('reads nothing from a word that only ends in a keyword or a keyword with no reference', () => {
    expect(closingReferences('the prefix #12 and suffix #13', here)).toEqual([]);
    expect(closingReferences('This fixes the board', here)).toEqual([]);
    expect(closingReferences(null, here)).toEqual([]);
  });
});

describe('SR-1 skip-ci markers in a commit message', () => {
  it('finds every marker GitHub honours, in any case', () => {
    for (const marker of [
      '[skip ci]',
      '[CI SKIP]',
      '[no ci]',
      '[skip actions]',
      '[actions skip]',
    ]) {
      expect(hasSkipCiMarker(`Tidy the board ${marker}`)).toBe(true);
    }
    expect(hasSkipCiMarker('Tidy the board\n\nskip-checks: true')).toBe(true);
  });

  it('finds no marker in an ordinary message', () => {
    expect(hasSkipCiMarker('Skip the empty state when CI is red')).toBe(false);
  });
});
