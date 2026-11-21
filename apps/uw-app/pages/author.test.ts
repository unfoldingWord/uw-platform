import { describe, expect, it } from 'vitest';
import { authorName } from './author.ts';

const PERSON = '00000000-0000-4000-8000-000000001761';
const DELEGATION = '00000000-0000-4000-8000-000000001762';

describe('#176 who a page version names as its author', () => {
  it('names a person by their name', () => {
    expect(authorName(`human:${PERSON}`, 'Jesse Griffin')).toBe('Jesse Griffin');
  });

  it("names an agent on a person's own machine as that person's agent", () => {
    expect(authorName(`agent:${PERSON}/laptop`, 'Jesse Griffin')).toBe("Jesse Griffin's agent");
  });

  it("names a delegated agent as the granting person's agent", () => {
    const delegated = `agent:${PERSON}/laptop as builder via delegation:${DELEGATION}`;
    expect(authorName(delegated, 'Jesse Griffin')).toBe("Jesse Griffin's agent");
  });

  it('keeps the identity when no person stands behind it', () => {
    expect(authorName('agent:builder', null)).toBe('agent:builder');
    expect(authorName(`agent:${PERSON}/laptop`, null)).toBe(`agent:${PERSON}/laptop`);
  });
});
