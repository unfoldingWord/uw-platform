import { describe, expect, it } from 'vitest';
import {
  consentFor,
  inventedExpressions,
  inventedStories,
  photoStory,
} from '../testing/stories.ts';

const userAssignedCountry = /^(?:AA|Q[M-Z]|X[A-Z]|ZZ)$/;
const localUseLanguage = /^q[a-t][a-z]$/;
const inventedName = /^[A-Z][a-z]+ Example$/;
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

const assignedCountryNames: readonly string[] = Array.from({ length: 26 * 26 }, (_, index) => {
  const code = String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26));
  return userAssignedCountry.test(code) ? undefined : regionNames.of(code);
}).filter((name): name is string => name !== undefined && name.length > 3);

const letter = /\p{L}/u;

function standsAlone(text: string, name: string): boolean {
  const at = text.indexOf(name);
  if (at === -1) return false;
  const before = text.charAt(at - 1);
  const after = text.charAt(at + name.length);
  return !letter.test(before) && !letter.test(after);
}

function placesNamedIn(text: string): readonly string[] {
  return assignedCountryNames.filter((name) => standsAlone(text, name));
}

const seeded = [...inventedStories, photoStory('00000000-0000-4000-8000-000000002014')];

describe('#201 every seeded test story is invented', () => {
  it.each(seeded)('#201 "$title" names an invented person and invented places only', (story) => {
    const { country, region, languages } = story.frontmatter;
    expect(story.subject).toMatch(inventedName);
    expect(country === null || userAssignedCountry.test(country)).toBe(true);
    expect(region === null || userAssignedCountry.test(region.slice(0, 2))).toBe(true);
    expect(languages.every((language) => localUseLanguage.test(language))).toBe(true);
    expect(placesNamedIn(`${story.title} ${story.bodyMd}`)).toEqual([]);
    const people = [...`${story.title} ${story.bodyMd}`.matchAll(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g)];
    expect(people.map(([name]) => name).filter((name) => !/Example$|^Region /.test(name))).toEqual(
      [],
    );
  });

  it('#201 the consent fixture names an invented person and an example address', () => {
    const consent = consentFor('00000000-0000-4000-8000-000000002013');
    expect(consent.consentedBy).toMatch(inventedName);
    expect(new URL(consent.consentReference).hostname).toMatch(/(^|\.)example\.org$/);
  });

  it.each(seeded)('ADR 0041 "$title" happened in an invented place', (story) => {
    expect(placesNamedIn(story.frontmatter.place ?? '')).toEqual([]);
    const place = story.frontmatter.place ?? 'Region One';
    expect(place).toMatch(/Region (?:One|Two|Three|Four)/);
  });

  it.each(inventedExpressions)(
    'ADR 0041 the expression "$title" links an example address and names no real place or person',
    (expression) => {
      expect(new URL(expression.url).hostname).toMatch(/(^|\.)example\.org$/);
      const text = `${expression.title} ${expression.venue} ${expression.excerpt ?? ''}`;
      expect(placesNamedIn(text)).toEqual([]);
      const people = [...text.matchAll(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g)];
      expect(
        people.map(([name]) => name).filter((name) => !/Example$|^Region /.test(name)),
      ).toEqual([]);
      expect(expression.language === null || localUseLanguage.test(expression.language)).toBe(true);
    },
  );

  it('#201 the check finds a real place when one is written', () => {
    expect(placesNamedIn('A story from Kenya')).toEqual(['Kenya']);
  });
});
