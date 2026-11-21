import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keyBetween } from './fractional.ts';

function ordered(keys: readonly string[]): boolean {
  return keys.every((key, i) => i === 0 || (keys[i - 1] ?? '') < key);
}

function insertedInOrder(choices: readonly number[]): boolean {
  const keys: string[] = [];
  for (const choice of choices) {
    const at = choice % (keys.length + 1);
    keys.splice(at, 0, keyBetween(keys[at - 1] ?? null, keys[at] ?? null));
  }
  return ordered(keys) && keys.every((key) => /^[0-9A-Za-z]+$/.test(key));
}

describe('#206 card order keys sort between their neighbours byte by byte', () => {
  it('places a first key, then keys before, after and between', () => {
    const first = keyBetween(null, null);
    const before = keyBetween(null, first);
    const after = keyBetween(first, null);
    const between = keyBetween(before, first);
    expect(ordered([before, between, first, after])).toBe(true);
  });

  it('keeps every key strictly between its neighbours for any sequence of inserts', () => {
    fc.assert(fc.property(fc.array(fc.nat(), { maxLength: 60 }), insertedInOrder));
  });

  it('refuses neighbours out of order', () => {
    expect(() => keyBetween('b', 'a')).toThrow(RangeError);
  });
});
