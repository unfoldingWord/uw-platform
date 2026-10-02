import type { GitHubFacts, PullRequestFacts, PullRequestRef } from '@uw/harness';

export type SimGitHubFacts = GitHubFacts & { given(facts: PullRequestFacts): void };

const keyOf = (ref: PullRequestRef): string => `${ref.repo.toLowerCase()}#${ref.number}`;

export function createSimGitHubFacts(): SimGitHubFacts {
  const known = new Map<string, PullRequestFacts>();
  const answer = async (ref: PullRequestRef): Promise<PullRequestFacts | null> => {
    const found = known.get(keyOf(ref));
    return found ? structuredClone(found) : null;
  };
  return {
    pullRequest: answer,
    refresh: answer,
    given: (facts) => {
      known.set(keyOf(facts.ref), structuredClone(facts));
    },
  };
}
