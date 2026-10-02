import type { Database } from '@uw/db/client';
import { notWiredCall, type Clock, type GitHubFacts } from '@uw/harness';
import { pullRequestFacts } from '../github/facts/queries.ts';
import { refreshPullRequest, type OpenReads } from '../github/refresh.ts';

export function platformGitHubFacts(
  db: Database,
  github: OpenReads | null,
  clock: Clock,
): GitHubFacts {
  return {
    pullRequest: (ref) => pullRequestFacts(db, ref),
    refresh: (ref) =>
      github === null
        ? notWiredCall('githubFacts', 'refresh')
        : refreshPullRequest(github(), db, ref, clock.now()),
  };
}
