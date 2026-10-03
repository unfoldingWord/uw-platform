import { describe, expect, it } from 'vitest';
import type { DiffRange, GitHubFacts, PullRequestFacts, PullRequestRef } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type GithubFactsSubject = {
  readonly facts: GitHubFacts;
  given(facts: PullRequestFacts): Promise<void>;
  givenDiff(ref: PullRequestRef, range: DiffRange, text: string): Promise<void>;
  now(): Date;
};

const diffRef: PullRequestRef = { repo: 'unfoldingWord/uw-platform', number: 21 };
const diffRange: DiffRange = { base: '0'.repeat(40), head: 'a'.repeat(40) };
const diffText = 'diff --git a/board.tsx b/board.tsx\n+const title = ’Board’;\n';
const diffBytes = [...diffText].reduce((total, character) => {
  const point = character.codePointAt(0) ?? 0;
  return total + (point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4);
}, 0);

function factsFor(repo: string, number: number, head: string): PullRequestFacts {
  return {
    ref: { repo, number },
    state: 'open',
    draft: false,
    head,
    headRef: 'harness/b1000000-0000-4000-8000-000000000002',
    headRepo: repo,
    base: '0'.repeat(40),
    baseRef: 'main',
    defaultBranch: 'main',
    checks: [
      {
        checkId: 9100000001,
        name: 'test',
        headSha: head,
        app: 'github-actions',
        conclusion: 'success',
      },
    ],
    reviews: [
      {
        reviewId: 9100000101,
        reviewer: 'uw-reviewer[bot]',
        commit: head,
        state: 'approved',
        provider: 'fixture-provider',
        submittedAt: new Date('2026-10-01T08:59:00.000Z'),
      },
    ],
    files: { head, base: '0'.repeat(40), paths: ['apps/uw-app/board.tsx'] },
    declaration: {
      closes: ['#7'],
      risks: 'none known',
      touches: 'the board',
      riskTier: 'standard',
      riskDomains: [],
    },
    freshAt: new Date('2026-10-01T09:00:00.000Z'),
  };
}

type DiffReads = 'scripted' | 'not_wired';

export function describeGithubFactsContract(
  adapter: string,
  open: () => Promise<GithubFactsSubject>,
  diffs: DiffReads,
): void {
  describe(`DX-3 githubFacts port contract on ${adapter}`, () => {
    it('answers null for a pull request it has no facts for', async () => {
      const subject = await open();
      expect(
        await subject.facts.pullRequest({ repo: 'unfoldingWord/uw-platform', number: 404 }),
      ).toBeNull();
    });

    it('answers the facts it holds for a pull request', async () => {
      const subject = await open();
      const known = factsFor('unfoldingWord/uw-platform', 7, 'a'.repeat(40));
      await subject.given(known);
      expect(await subject.facts.pullRequest(known.ref)).toEqual(known);
    });

    it('keeps two repositories apart', async () => {
      const subject = await open();
      await subject.given(factsFor('unfoldingWord/uw-platform', 7, 'a'.repeat(40)));
      await subject.given(factsFor('unfoldingWord/other', 7, 'b'.repeat(40)));
      const answer = await subject.facts.pullRequest({
        repo: 'unfoldingWord/uw-platform',
        number: 7,
      });
      expect(answer?.head).toBe('a'.repeat(40));
    });

    shapeCases(open);
    defaultBranchCases(open);
    if (diffs === 'scripted') diffCases(open);
    else diffNotWiredCases(open);

    it('answers the latest facts after the head moves', async () => {
      const subject = await open();
      await subject.given(factsFor('unfoldingWord/uw-platform', 8, 'a'.repeat(40)));
      await subject.given(factsFor('unfoldingWord/uw-platform', 8, 'c'.repeat(40)));
      const answer = await subject.facts.pullRequest({
        repo: 'unfoldingWord/uw-platform',
        number: 8,
      });
      expect(answer?.head).toBe('c'.repeat(40));
    });
  });
}

function shapeCases(open: () => Promise<GithubFactsSubject>): void {
  it('round-trips the files, declaration, head ref and repository and check and review ids exactly', async () => {
    const subject = await open();
    const known = factsFor('unfoldingWord/uw-platform', 9, 'd'.repeat(40));
    await subject.given(known);
    const answer = await subject.facts.pullRequest(known.ref);
    expect(answer?.files).toEqual(known.files);
    expect(answer?.declaration).toEqual(known.declaration);
    expect(answer?.headRef).toBe(known.headRef);
    expect(answer?.headRepo).toBe(known.headRepo);
    expect(answer?.baseRef).toBe(known.baseRef);
    expect(answer?.checks).toEqual(known.checks);
    expect(answer?.reviews).toEqual(known.reviews);
  });

  it('round-trips a head in a fork and a head whose fork was deleted', async () => {
    const subject = await open();
    for (const [number, headRepo] of [
      [11, 'someone/uw-platform'],
      [12, null],
    ] as const) {
      const known = { ...factsFor('unfoldingWord/uw-platform', number, 'd'.repeat(40)), headRepo };
      await subject.given(known);
      expect((await subject.facts.pullRequest(known.ref))?.headRepo).toBe(headRepo);
    }
  });

  it('answers the same facts for a repository asked in another case', async () => {
    const subject = await open();
    const known = factsFor('unfoldingWord/uw-platform', 10, 'e'.repeat(40));
    await subject.given(known);
    const answer = await subject.facts.pullRequest({
      repo: 'UnfoldingWord/UW-Platform',
      number: 10,
    });
    expect(answer).toEqual(known);
  });

  it('refreshes to the facts GitHub holds, and to null when it holds none', async () => {
    const subject = await open();
    const known = factsFor('unfoldingWord/uw-platform', 11, 'f'.repeat(40));
    await subject.given(known);
    const called = subject.now();
    const refreshed = await subject.facts.refresh(known.ref);
    expect(refreshed === null ? null : { ...refreshed, freshAt: known.freshAt }).toEqual(known);
    expect(refreshed?.freshAt.getTime()).toBeGreaterThanOrEqual(called.getTime());
    expect(
      await subject.facts.refresh({ repo: 'unfoldingWord/uw-platform', number: 405 }),
    ).toBeNull();
  });
}

function defaultBranchCases(open: () => Promise<GithubFactsSubject>): void {
  it('answers the repository’s default branch after it is renamed', async () => {
    const subject = await open();
    const known = factsFor('unfoldingWord/uw-platform', 13, 'd'.repeat(40));
    await subject.given(known);
    expect((await subject.facts.pullRequest(known.ref))?.defaultBranch).toBe('main');
    const renamed = { ...known, baseRef: 'trunk', defaultBranch: 'trunk' };
    await subject.given(renamed);
    expect(await subject.facts.pullRequest(known.ref)).toMatchObject({
      baseRef: 'trunk',
      defaultBranch: 'trunk',
    });
    expect((await subject.facts.refresh(known.ref))?.defaultBranch).toBe('trunk');
  });
}

function diffCases(open: () => Promise<GithubFactsSubject>): void {
  it('answers the diff with its UTF-8 byte length when it fits the budget, the budget itself included', async () => {
    const subject = await open();
    await subject.givenDiff(diffRef, diffRange, diffText);
    expect(diffBytes).toBeGreaterThan(diffText.length);
    for (const budget of [diffBytes, diffBytes + 1]) {
      expect(await subject.facts.diff(diffRef, diffRange, budget)).toEqual({
        kind: 'diff',
        text: diffText,
        bytes: diffBytes,
      });
    }
  });

  diffBudgetCases(open);
  diffRangeCases(open);
}

function diffBudgetCases(open: () => Promise<GithubFactsSubject>): void {
  it('answers too large, without the text, when the diff exceeds the budget', async () => {
    const subject = await open();
    await subject.givenDiff(diffRef, diffRange, diffText);
    const answer = await subject.facts.diff(diffRef, diffRange, diffBytes - 1);
    expect(answer.kind).toBe('too_large');
    expect(answer).not.toHaveProperty('text');
    if (answer.kind === 'too_large' && answer.bytes !== null) {
      expect(answer.bytes).toBeGreaterThan(diffBytes - 1);
    }
  });

  it('answers too large, without the text, for a budget that is not a non-negative safe integer', async () => {
    const subject = await open();
    await subject.givenDiff(diffRef, diffRange, diffText);
    for (const budget of [Number.NaN, Infinity, -Infinity, -1, diffBytes + 0.5, 2 ** 53]) {
      const answer = await subject.facts.diff(diffRef, diffRange, budget);
      expect(answer.kind).toBe('too_large');
      expect(answer).not.toHaveProperty('text');
    }
  });
}

function diffRangeCases(open: () => Promise<GithubFactsSubject>): void {
  it('answers the diff of the range asked, not of another head', async () => {
    const subject = await open();
    await subject.givenDiff(diffRef, diffRange, diffText);
    await subject.givenDiff(
      diffRef,
      { ...diffRange, head: 'b'.repeat(40) },
      'diff --git a/x b/x\n',
    );
    expect(await subject.facts.diff(diffRef, diffRange, 80_000)).toMatchObject({
      text: diffText,
    });
  });

  it('answers unavailable with a reason, never throws, for a range it holds no diff for', async () => {
    const subject = await open();
    const answer = await subject.facts.diff(
      diffRef,
      { ...diffRange, head: 'c'.repeat(40) },
      80_000,
    );
    expect(answer).toMatchObject({ kind: 'unavailable', reason: expect.any(String) });
  });
}

function diffNotWiredCases(open: () => Promise<GithubFactsSubject>): void {
  it('answers unavailable not_wired for every diff until the diff read is wired', async () => {
    const subject = await open();
    expect(await subject.facts.diff(diffRef, diffRange, 80_000)).toEqual({
      kind: 'unavailable',
      reason: 'not_wired',
    });
  });
}

export function describeGithubFactsNotWired(adapter: string, facts: GitHubFacts): void {
  describeNotWired('githubFacts', adapter, facts, {
    pullRequest: true,
    refresh: true,
    diff: true,
  } satisfies Record<keyof GitHubFacts, true>);
}
