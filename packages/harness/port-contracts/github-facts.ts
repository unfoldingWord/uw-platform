import { describe, expect, it } from 'vitest';
import type { GitHubFacts, PullRequestFacts } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type GithubFactsSubject = {
  readonly facts: GitHubFacts;
  given(facts: PullRequestFacts): Promise<void>;
  now(): Date;
};

function factsFor(repo: string, number: number, head: string): PullRequestFacts {
  return {
    ref: { repo, number },
    state: 'open',
    draft: false,
    head,
    headRef: 'harness/b1000000-0000-4000-8000-000000000002',
    base: '0'.repeat(40),
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

export function describeGithubFactsContract(
  adapter: string,
  open: () => Promise<GithubFactsSubject>,
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
  it('round-trips the files, declaration, head ref and check and review ids exactly', async () => {
    const subject = await open();
    const known = factsFor('unfoldingWord/uw-platform', 9, 'd'.repeat(40));
    await subject.given(known);
    const answer = await subject.facts.pullRequest(known.ref);
    expect(answer?.files).toEqual(known.files);
    expect(answer?.declaration).toEqual(known.declaration);
    expect(answer?.headRef).toBe(known.headRef);
    expect(answer?.checks).toEqual(known.checks);
    expect(answer?.reviews).toEqual(known.reviews);
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

export function describeGithubFactsNotWired(adapter: string, facts: GitHubFacts): void {
  describeNotWired('githubFacts', adapter, facts, {
    pullRequest: true,
    refresh: true,
  } satisfies Record<keyof GitHubFacts, true>);
}
