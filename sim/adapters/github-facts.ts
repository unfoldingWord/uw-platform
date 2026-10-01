import type { GitHubFacts, PullRequestFacts, PullRequestRef } from '@uw/harness';

export type SimGitHubFacts = GitHubFacts & { given(facts: PullRequestFacts): void };

const keyOf = (ref: PullRequestRef): string => `${ref.repo}#${ref.number}`;

export function createSimGitHubFacts(): SimGitHubFacts {
  const known = new Map<string, PullRequestFacts>();
  return {
    pullRequest: async (ref) => {
      const found = known.get(keyOf(ref));
      return found ? structuredClone(found) : null;
    },
    given: (facts) => {
      known.set(keyOf(facts.ref), structuredClone(facts));
    },
  };
}
