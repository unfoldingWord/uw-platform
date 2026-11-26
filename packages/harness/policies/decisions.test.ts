import { describe, expect, it } from 'vitest';
import { supersededDecisions } from './decisions.ts';

const decision = (id: string, decidedOn: string, supersedes: string[] = []) => ({
  id,
  decidedOn,
  supersedes,
});

describe('PO-3 a decision page replaces only one decided before it', () => {
  it('lets a later decision replace an earlier one', () => {
    const replaced = supersededDecisions([
      decision('january', '2026-01-10'),
      decision('june', '2026-06-01', ['january']),
    ]);
    expect([...replaced]).toEqual(['january']);
  });

  it('ignores a backwards reference from an earlier decision', () => {
    const replaced = supersededDecisions([
      decision('january', '2026-01-10', ['june']),
      decision('june', '2026-06-01'),
    ]);
    expect([...replaced]).toEqual([]);
  });

  it('on the same day, lets one replace the other unless both name each other', () => {
    expect([
      ...supersededDecisions([decision('a', '2026-03-01'), decision('b', '2026-03-01', ['a'])]),
    ]).toEqual(['a']);
    expect([
      ...supersededDecisions([
        decision('a', '2026-03-01', ['b']),
        decision('b', '2026-03-01', ['a']),
      ]),
    ]).toEqual([]);
  });
});
