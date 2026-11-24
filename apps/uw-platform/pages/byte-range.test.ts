import { describe, expect, it } from 'vitest';
import { rangeOf } from './byte-range.ts';

describe('a Range header picks one span of a stored file', () => {
  it('reads a closed span, an open-ended span and a suffix', () => {
    expect(rangeOf('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(rangeOf('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(rangeOf('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('clips an end past the file to its last byte', () => {
    expect(rangeOf('bytes=500-5000', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('answers the whole file when there is no header, or one it does not read', () => {
    expect(rangeOf(null, 1000)).toBeNull();
    expect(rangeOf('bytes=0-1,5-9', 1000)).toBeNull();
    expect(rangeOf('items=0-9', 1000)).toBeNull();
  });

  it('refuses a span that starts past the end or runs backwards', () => {
    expect(rangeOf('bytes=1000-', 1000)).toBe('unsatisfiable');
    expect(rangeOf('bytes=9-1', 1000)).toBe('unsatisfiable');
    expect(rangeOf('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});
