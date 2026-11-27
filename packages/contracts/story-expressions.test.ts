import { describe, expect, it } from 'vitest';
import { impactStoryFrontmatterSchema } from './stories.ts';
import { expressionFormats, expressionUrl } from './story-expressions.ts';
import { listStoriesInputSchema } from './story-verb-io.ts';

describe('ADR 0041 an expression is linked by one normalised https address', () => {
  it.each([
    [
      'HTTPS://Docs.Example.org:443/document/d/abc/edit',
      'https://docs.example.org/document/d/abc/edit',
    ],
    [
      'https://docs.example.org/document/d/abc/edit#heading=h.1',
      'https://docs.example.org/document/d/abc/edit',
    ],
    ['  https://social.example.org/posts/1?ref=a  ', 'https://social.example.org/posts/1?ref=a'],
    ['https://example.org', 'https://example.org/'],
  ])('ADR 0041 stores %s as %s', (given, stored) => {
    expect(expressionUrl(given)).toBe(stored);
  });

  it.each([
    'http://news.example.org/story',
    'ftp://files.example.org/story.pdf',
    'javascript:alert(1)',
    'mailto:someone@example.org',
    'https://someone:secret@docs.example.org/d/abc',
    'docs.example.org/d/abc',
    'not an address',
  ])('ADR 0041 refuses %s', (given) => {
    expect(expressionUrl(given)).toBeNull();
  });
});

describe('ADR 0041 the story record holds when, where and which programs', () => {
  it('ADR 0041 reads a record written before the new fields with each one empty', () => {
    const parsed = impactStoryFrontmatterSchema.parse({ jd_category: '41' });
    expect(parsed).toMatchObject({ occurred_on: null, place: null, programs: [] });
  });

  it('ADR 0041 takes a whole day, a short place and distinct program ids', () => {
    const program = '00000000-0000-4000-8000-000000004102';
    const record = {
      jd_category: '41',
      occurred_on: '2026-03-14',
      place: 'Region One',
      programs: [program],
    };
    expect(impactStoryFrontmatterSchema.safeParse(record).success).toBe(true);
    for (const wrong of [
      { occurred_on: '2026-03' },
      { place: ' ' },
      { place: 'x'.repeat(121) },
      { programs: [program, program] },
      { programs: ['program-one'] },
    ]) {
      expect(impactStoryFrontmatterSchema.safeParse({ ...record, ...wrong }).success).toBe(false);
    }
  });
});

describe('ADR 0041 list_stories finds by program, country, format and title words', () => {
  it('ADR 0041 defaults every filter to none and caps the page at a hundred', () => {
    expect(listStoriesInputSchema.parse({})).toEqual({
      query: null,
      program: null,
      country: null,
      formatPresent: null,
      formatAbsent: null,
      limit: 50,
    });
    expect(listStoriesInputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(listStoriesInputSchema.safeParse({ formatPresent: 'tweet' }).success).toBe(false);
  });

  it('ADR 0041 names thirteen formats, ending with other', () => {
    expect(expressionFormats).toHaveLength(13);
    expect(expressionFormats.at(-1)).toBe('other');
  });
});
