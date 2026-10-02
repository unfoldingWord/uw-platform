import { notWiredCall, type GitHubFacts } from '@uw/harness';

export const githubFactsNotWired: GitHubFacts = {
  pullRequest: () => notWiredCall('githubFacts', 'pullRequest'),
  refresh: () => notWiredCall('githubFacts', 'refresh'),
};
