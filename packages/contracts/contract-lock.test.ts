import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import lock from './contract-lock.json' with { type: 'json' };
import { schemaRegistry } from './registry.ts';
import { CONTRACT_VERSION } from './version.ts';

type Sets = Record<string, readonly string[]>;
type Entry = { version: string; sets: Sets };

const entries: readonly Entry[] = lock.versions;

function currentSets(): Sets {
  const enums = Object.entries(schemaRegistry).flatMap(([key, schema]) =>
    schema instanceof z.ZodEnum ? [[key, [...schema.options].map(String)] as const] : [],
  );
  return Object.fromEntries([...enums].sort(([a], [b]) => a.localeCompare(b)));
}

function parts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}

function isAfter(later: string, earlier: string): boolean {
  const [a, b] = [parts(later), parts(earlier)];
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}

function removed(before: Sets, after: Sets): string[] {
  return Object.entries(before).flatMap(([key, values]) => {
    const kept = after[key];
    if (!kept) return [`${key} (whole set)`];
    return values.filter((value) => !kept.includes(value)).map((value) => `${key}:${value}`);
  });
}

function added(before: Sets, after: Sets): string[] {
  return Object.entries(after).flatMap(([key, values]) => {
    const earlier = before[key] ?? [];
    return values.filter((value) => !earlier.includes(value)).map((value) => `${key}:${value}`);
  });
}

function sameMajor([earlier, later]: [Entry, Entry]): boolean {
  return parts(later.version)[0] === parts(earlier.version)[0];
}

function sameMinorOrLower([earlier, later]: [Entry, Entry]): boolean {
  return sameMajor([earlier, later]) && parts(later.version)[1] === parts(earlier.version)[1];
}

function breakingWithoutMajor(pair: [Entry, Entry]): boolean {
  return removed(pair[0].sets, pair[1].sets).length > 0 && sameMajor(pair);
}

function additiveWithoutMinor(pair: [Entry, Entry]): boolean {
  return added(pair[0].sets, pair[1].sets).length > 0 && sameMinorOrLower(pair);
}

function versionsOf(offending: [Entry, Entry][]): string[] {
  return offending.map(([, later]) => later.version);
}

const pairs = entries.slice(1).map((entry, index) => [entries[index], entry] as [Entry, Entry]);

describe('CT-3 the contract lock', () => {
  it('ends at the live CONTRACT_VERSION', () => {
    expect(entries.at(-1)?.version).toBe(CONTRACT_VERSION);
  });

  it('records every closed set exactly as it is now', () => {
    expect(entries.at(-1)?.sets).toEqual(currentSets());
  });

  it('lists versions in strictly increasing order', () => {
    expect(pairs.filter(([earlier, later]) => !isAfter(later.version, earlier.version))).toEqual(
      [],
    );
  });

  it('takes a major version whenever a value or a set is removed or renamed', () => {
    expect(versionsOf(pairs.filter(breakingWithoutMajor))).toEqual([]);
  });

  it('takes at least a minor version whenever a value or a set is added', () => {
    expect(versionsOf(pairs.filter(additiveWithoutMinor))).toEqual([]);
  });
});

describe('CT-3 the bump rule detects what it claims to', () => {
  const before: Sets = { role: ['admin', 'editor'] };

  it('sees an added value as additive and not breaking', () => {
    const after: Sets = { role: ['admin', 'editor', 'viewer'] };
    expect(added(before, after)).toEqual(['role:viewer']);
    expect(removed(before, after)).toEqual([]);
  });

  it('sees a renamed value as both a removal and an addition', () => {
    const after: Sets = { role: ['admin', 'owner'] };
    expect(removed(before, after)).toEqual(['role:editor']);
    expect(added(before, after)).toEqual(['role:owner']);
  });

  it('sees a dropped set as a removal', () => {
    expect(removed(before, {})).toEqual(['role (whole set)']);
  });

  it('flags a patch bump that adds and a minor bump that removes', () => {
    const patchAdd: [Entry, Entry] = [
      { version: '1.0.0', sets: before },
      { version: '1.0.1', sets: { role: ['admin', 'editor', 'viewer'] } },
    ];
    const minorRemove: [Entry, Entry] = [
      { version: '1.0.0', sets: before },
      { version: '1.1.0', sets: { role: ['admin'] } },
    ];
    expect(additiveWithoutMinor(patchAdd)).toBe(true);
    expect(breakingWithoutMajor(minorRemove)).toBe(true);
    expect(
      breakingWithoutMajor([patchAdd[0], { version: '2.0.0', sets: { role: ['admin'] } }]),
    ).toBe(false);
  });
});
