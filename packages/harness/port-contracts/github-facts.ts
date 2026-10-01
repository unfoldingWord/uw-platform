import { describe, expect, it } from 'vitest';
import type { GitHubFacts, PullRequestFacts } from '../ports.ts';
import { describeNotWired } from './not-wired-cases.ts';

export type GithubFactsSubject = {
  readonly facts: GitHubFacts;
  given(facts: PullRequestFacts): Promise<void>;
};

function factsFor(repo: string, number: number, head: string): PullRequestFacts {
  return {
    ref: { repo, number },
    state: 'open',
    draft: false,
    head,
    checks: [{ name: 'test', headSha: head, conclusion: 'success' }],
    reviews: [
      { reviewer: 'uw-reviewer', commit: head, state: 'approved', provider: 'fixture-provider' },
    ],
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

export function describeGithubFactsNotWired(adapter: string, facts: GitHubFacts): void {
  describeNotWired('githubFacts', adapter, facts, { pullRequest: true } satisfies Record<
    keyof GitHubFacts,
    true
  >);
}
