import { describe, expect, it } from 'vitest';
import { advisoryLocks } from './advisory-locks.ts';

describe('FD-8 FD-9 advisory lock keys live in one registry', () => {
  it('names the grant-command and page re-parent keys', () => {
    expect(advisoryLocks).toEqual({ grantCommands: 7301001, pageReparenting: 7301002 });
  });

  it('gives every lock a distinct key', () => {
    const keys = Object.values(advisoryLocks);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps every key a positive safe integer', () => {
    const invalid = Object.values(advisoryLocks).filter(
      (key) => !Number.isSafeInteger(key) || key <= 0,
    );
    expect(invalid).toEqual([]);
  });
});
