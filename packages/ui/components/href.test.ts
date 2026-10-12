import { describe, expect, it } from 'vitest';
import { safeHref } from './href.ts';

describe('a shell link accepts only a relative path or https', () => {
  it.each([
    '/',
    '/health',
    '/harness/a?b=c#d',
    '#main',
    'board',
    '?page=2',
    'https://github.com/unfoldingWord',
  ])('keeps %s', (href) => {
    expect(safeHref(href)).toBe(href);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,x',
    'http://example.org/',
    'vbscript:x',
    '//evil.example/',
    '/\\evil.example/',
    '\\\\evil.example',
    '',
  ])('refuses %j', (href) => {
    expect(safeHref(href)).toBeUndefined();
  });
});
