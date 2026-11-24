import type { Database } from '@uw/db/client';
import { recordFiles } from '../github/facts/heads.ts';
import { upsertFacts } from '../github/facts/upsert.ts';
import { base, openedPull, repo } from '../github/testing/facts-fixtures.ts';

export type PullRequestSeed = {
  readonly repoId: number;
  readonly pullRequestId: number;
  readonly repo: string;
  readonly number: number;
  readonly head: string;
  readonly headRef: string;
  readonly paths: readonly string[];
  readonly freshAt: Date;
};

export async function seedPullRequest(db: Database, seed: PullRequestSeed): Promise<void> {
  const repos = [{ ...repo, githubId: seed.repoId, fullName: seed.repo }];
  const pullRequests = [
    {
      ...openedPull,
      githubId: seed.pullRequestId,
      repoId: seed.repoId,
      number: seed.number,
      headSha: seed.head,
      headRef: seed.headRef,
      headRepo: seed.repo,
      baseSha: base,
    },
  ];
  const empty = { milestones: [], issues: [], files: [], checkRuns: [], reviews: [] };
  await upsertFacts(db, { ...empty, repos, pullRequests }, seed.freshAt);
  const files = { head: seed.head, base, paths: seed.paths, problem: null };
  const commits = [{ sha: seed.head, merge: false, skipCi: false, closes: [] }];
  const atHead = { behindBy: 0, patchId: null, commits };
  await recordFiles(db, { pullRequestId: seed.pullRequestId, ...files, ...atHead });
}
