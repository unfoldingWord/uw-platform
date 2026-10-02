import { describe, expect, it } from 'vitest';
import { branchFor, fullSha, normalisedIdentifier, sameRepository } from './identifiers.ts';

const upper40 = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
const lower64 = 'abcdef0123456789'.repeat(4);

describe('GH-5 identifiers from GitHub are normalised or count as nothing', () => {
  it('trims and lowercases an identifier', () => {
    expect(normalisedIdentifier('  UW-Reviewer ')).toBe('uw-reviewer');
  });

  it('folds a fullwidth identifier through NFKC', () => {
    expect(normalisedIdentifier('ｕｗ-reviewer')).toBe('uw-reviewer');
  });

  it('counts an identifier outside [a-z0-9._-] as nothing', () => {
    expect(normalisedIdentifier('uw reviewer')).toBeNull();
    expect(normalisedIdentifier('')).toBeNull();
    expect(normalisedIdentifier('uw-reviewer[bot]')).toBeNull();
  });

  it('lowercases a full SHA', () => {
    expect(fullSha(upper40)).toBe(upper40.toLowerCase());
    expect(fullSha(lower64)).toBe(lower64);
  });

  it('rejects an abbreviated or overlong SHA', () => {
    expect(fullSha('abc123')).toBeNull();
    expect(fullSha(`${upper40}a`)).toBeNull();
    expect(fullSha('g'.repeat(40))).toBeNull();
  });

  it('compares repositories case-insensitively and never matches a missing one', () => {
    expect(sameRepository('UnfoldingWord/UW-Platform', 'unfoldingWord/uw-platform')).toBe(true);
    expect(sameRepository('unfoldingWord/uw-platform', 'unfoldingWord/uw-other')).toBe(false);
    expect(sameRepository('unfoldingWord/uw-platform', null)).toBe(false);
  });
});

describe('the item branch name', () => {
  it('is harness/<item id>', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(branchFor(id)).toBe(`harness/${id}`);
  });
});
