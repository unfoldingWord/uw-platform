import { describe, expect, it } from 'vitest';
import { headFactsOf } from './head-facts.ts';
import { patchIdOf } from './patch-id.ts';

const here = 'unfoldingWord/uw-platform';
const sha = (seed: string) => seed.padEnd(40, '0');

const file = (patch: string) => ({ filename: 'apps/uw-app/board.tsx', status: 'modified', patch });

describe('SR-2 the patch id is the change against the merge base', () => {
  it('stays the same when only the hunk positions move', async () => {
    const before = await patchIdOf([file('@@ -10,2 +10,3 @@ function Board\n a\n+b\n c')]);
    const after = await patchIdOf([file('@@ -14,2 +14,3 @@ function Board\n a\n+b\n c')]);
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(after).toBe(before);
  });

  it('changes when a line of the change changes, and is the same in any file order', async () => {
    const one = await patchIdOf([
      file('@@ -1 +1 @@\n-a\n+b'),
      { filename: 'z.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+z' },
    ]);
    const reordered = await patchIdOf([
      { filename: 'z.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+z' },
      file('@@ -1 +1 @@\n-a\n+b'),
    ]);
    const changed = await patchIdOf([
      file('@@ -1 +1 @@\n-a\n+c'),
      { filename: 'z.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+z' },
    ]);
    expect(reordered).toBe(one);
    expect(changed).not.toBe(one);
  });

  it('uses the blob sha of a file with no patch, and is unknown when neither is given', async () => {
    expect(await patchIdOf([{ filename: 'logo.png', status: 'added', sha: sha('b10b') }])).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(await patchIdOf([{ filename: 'logo.png', status: 'added' }])).toBeNull();
  });
});

describe('SR-1 SR-2 the head facts from one compare answer', () => {
  const commits = [
    {
      sha: sha('a1'),
      commit: { message: 'Show the board\n\nFixes #12' },
      parents: [{ sha: sha('ba5e') }],
    },
    {
      sha: sha('b2'),
      commit: { message: "Merge branch 'main' [skip ci]" },
      parents: [{ sha: sha('a1') }, { sha: sha('ba5f') }],
    },
  ];

  it('reads the distance behind the base, the merges, the markers and the closing references', async () => {
    const facts = await headFactsOf(
      { files: [file('@@ -1 +1 @@\n-a\n+b')], behindBy: 2, commits },
      here,
    );
    expect(facts.behindBy).toBe(2);
    expect(facts.patchId).toMatch(/^[0-9a-f]{64}$/);
    expect(facts.commits).toEqual([
      { sha: sha('a1'), merge: false, skipCi: false, closes: [{ repo: here, number: 12 }] },
      { sha: sha('b2'), merge: true, skipCi: true, closes: [] },
    ]);
  });

  it('knows no patch id at the file cap and no commits when GitHub listed only some', async () => {
    const facts = await headFactsOf(
      { files: 'too_many_files', behindBy: null, commits: null },
      here,
    );
    expect(facts).toEqual({ behindBy: null, patchId: null, commits: null });
  });

  it('knows no commits past the hundred the read model holds, or one it cannot read', async () => {
    const many = Array.from({ length: 101 }, (_, n) => ({
      sha: sha(`c${String(n)}`),
      commit: { message: 'Tidy' },
      parents: [{ sha: sha('ba5e') }],
    }));
    const files = [file('@@ -1 +1 @@\n-a\n+b')];
    expect((await headFactsOf({ files, behindBy: 0, commits: many }, here)).commits).toBeNull();
    const short = [{ sha: 'abc', commit: { message: 'Tidy' }, parents: [] }];
    expect((await headFactsOf({ files, behindBy: 0, commits: short }, here)).commits).toBeNull();
  });
});
