import { describe, expect, it } from 'vitest';
import { diffStat } from './diff-stat.ts';

const diff = [
  'diff --git a/apps/board.tsx b/apps/board.tsx',
  'index 1111111..2222222 100644',
  '--- a/apps/board.tsx',
  '+++ b/apps/board.tsx',
  '@@ -1,3 +1,4 @@',
  ' unchanged',
  '-old line',
  '+new line',
  '++++ a line that starts with three pluses',
  '\\ No newline at end of file',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 90%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  '',
].join('\n');

describe('FL-3 a diff is measured in changed lines and touched paths', () => {
  it('FL-3 counts plus and minus lines inside hunks only, and names both sides of a rename', () => {
    expect(diffStat(diff)).toEqual({
      lines: 3,
      paths: ['apps/board.tsx', 'old/name.ts', 'new/name.ts'],
    });
  });

  it('FL-3 an empty diff changes nothing', () => {
    expect(diffStat('')).toEqual({ lines: 0, paths: [] });
  });
});
