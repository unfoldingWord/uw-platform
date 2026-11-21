import { describe, expect, it } from 'vitest';
import { lineChanges } from './diff.ts';

function marks(before: string, after: string): string[] | null {
  const changes = lineChanges(before, after);
  return changes === null
    ? null
    : changes.map((line) => `${{ same: ' ', added: '+', removed: '-' }[line.kind]}${line.text}`);
}

describe('#175 two versions of a page are compared line by line', () => {
  it('marks only the lines that differ, in order', () => {
    expect(marks('a\nb\nc', 'a\nx\nc\nd')).toEqual([' a', '-b', '+x', ' c', '+d']);
  });

  it('reports no change for the same text and handles empty text', () => {
    expect(marks('a\nb', 'a\nb')).toEqual([' a', ' b']);
    expect(marks('', 'a')).toEqual(['+a']);
    expect(marks('a', '')).toEqual(['-a']);
  });

  it('declines to compare texts too long to compare quickly', () => {
    const long = Array.from({ length: 3000 }, (_, index) => `line ${String(index)}`).join('\n');
    expect(marks(long, `${long}\nmore`)).toBeNull();
  });
});
