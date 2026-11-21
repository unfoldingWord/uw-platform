import { describe, expect, it } from 'vitest';
import type { PageIndexEntry } from '@uw/contracts';
import { createMatcher } from './switcher-match.ts';

function entry(n: number, title: string, more: Partial<PageIndexEntry> = {}): PageIndexEntry {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title,
    type: 'knowledge',
    jdArea: '00-09',
    jdId: null,
    aliases: [],
    ...more,
  };
}

const entries = [
  entry(1, '01.47 Security Guidelines', { jdId: '01.47' }),
  entry(2, '01.26 Budgeting', { jdId: '01.26' }),
  entry(3, '01.34 Best practices - Zoom', { jdId: '01.34' }),
  entry(4, 'Strategic Intents', { jdId: '01.12', aliases: ['Portfolios'] }),
  entry(5, 'Innovation'),
];

const found = (query: string, limit = 10): string[] =>
  createMatcher(entries)(query, limit).map((match) => match.title);

describe('#175 the Quick Switcher matches titles, JD IDs and aliases', () => {
  it('finds a page by part of its title, in any word order', () => {
    expect(found('sec guide')).toEqual(['01.47 Security Guidelines']);
    expect(found('zoom best')).toEqual(['01.34 Best practices - Zoom']);
    expect(found('INNOV')).toEqual(['Innovation']);
  });

  it('finds a page by its JD ID with or without the dot, even when the title does not carry it', () => {
    expect(found('01.47')).toEqual(['01.47 Security Guidelines']);
    expect(found('0147')).toEqual(['01.47 Security Guidelines']);
    expect(found('0112')).toEqual(['Strategic Intents']);
  });

  it('finds a page by an alias and forgives one slip of the fingers', () => {
    expect(found('portfolios')).toEqual(['Strategic Intents']);
    expect(found('bugdeting')).toEqual(['01.26 Budgeting']);
  });

  it('returns nothing for an empty query or one that matches nothing, and no more than the limit', () => {
    expect(found('')).toEqual([]);
    expect(found('   ')).toEqual([]);
    expect(found('zzzz')).toEqual([]);
    expect(found('01', 2)).toHaveLength(2);
  });
});
