import { describe, expect, it } from 'vitest';
import type { BaseComparison, HeadCommit } from '../ports.ts';
import { carriedCommits } from './carry.ts';

const approved = 'a'.repeat(40);
const merged = 'b'.repeat(40);
const fixed = 'c'.repeat(40);
const patch = '1'.repeat(64);
const other = '2'.repeat(64);

function commit(sha: string, merge: boolean): HeadCommit {
  return { sha, merge, skipCi: false, closes: [] };
}

function comparison(
  commits: readonly HeadCommit[],
  patchIds: Record<string, string>,
): BaseComparison {
  const head = commits.at(-1)?.sha ?? approved;
  return {
    head,
    base: '0'.repeat(40),
    behindBy: 0,
    patchId: patchIds[head] ?? null,
    commits,
    patchIds,
  };
}

describe('SR-2 an approval carries across merges from base with the same patch id', () => {
  it('carries the approved commit across one merge from base', () => {
    const compared = comparison([commit(approved, false), commit(merged, true)], {
      [approved]: patch,
      [merged]: patch,
    });
    expect(carriedCommits(compared, merged)).toEqual([approved]);
  });

  it('does not carry across a code change, even a merge after it', () => {
    const changed = comparison(
      [commit(approved, false), commit(fixed, false), commit(merged, true)],
      { [approved]: patch, [fixed]: other, [merged]: other },
    );
    expect(carriedCommits(changed, merged)).toEqual([fixed]);
    expect(carriedCommits(changed, merged)).not.toContain(approved);
  });

  it('does not carry when the patch id changed across the merge', () => {
    const compared = comparison([commit(approved, false), commit(merged, true)], {
      [approved]: patch,
      [merged]: other,
    });
    expect(carriedCommits(compared, merged)).toEqual([]);
  });

  it('does not carry a commit the head no longer contains, as after a rebase', () => {
    const rebased = comparison([commit(fixed, false), commit(merged, true)], {
      [approved]: patch,
      [fixed]: patch,
      [merged]: patch,
    });
    expect(carriedCommits(rebased, merged)).toEqual([fixed]);
  });

  it('carries nothing when the commits or the patch id are unknown', () => {
    const known = comparison([commit(approved, false), commit(merged, true)], {
      [approved]: patch,
      [merged]: patch,
    });
    expect(carriedCommits({ ...known, commits: null }, merged)).toEqual([]);
    expect(carriedCommits({ ...known, patchId: null }, merged)).toEqual([]);
  });

  it('carries nothing for a head the comparison was not made at', () => {
    const known = comparison([commit(approved, false), commit(merged, true)], {
      [approved]: patch,
      [merged]: patch,
    });
    expect(carriedCommits(known, fixed)).toEqual([]);
  });
});
