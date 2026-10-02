import { z } from 'zod';
import type { Database } from '@uw/db/client';
import { sameRepository, type PullRequestFacts, type PullRequestRef } from '@uw/harness';
import type { GitHubReads } from './client.ts';
import type { GitHubFailure, GitHubResult } from './failures.ts';
import { fetchFilesAtHead } from './facts/files.ts';
import {
  checkRunsFromRest,
  factsFromPull,
  repoFromRest,
  reviewsFromRest,
} from './facts/normalise.ts';
import { pullRequestFacts } from './facts/queries.ts';
import type { FactBatch, PullRequestRecord, RepoRecord } from './facts/records.ts';
import { upsertFacts } from './facts/upsert.ts';

export type OpenReads = () => GitHubReads;

class GitHubRefreshError extends Error {
  readonly failure: GitHubFailure;

  constructor(failure: GitHubFailure) {
    super(`the pull request could not be read again from GitHub: ${failure}`);
    this.name = 'GitHubRefreshError';
    this.failure = failure;
  }
}

const withBaseRepository = z.object({ base: z.object({ repo: z.unknown() }) });

function answered<T>(result: GitHubResult<T>): T {
  if (!result.ok) throw new GitHubRefreshError(result.failure);
  return result.value;
}

type Reread = {
  readonly batch: FactBatch;
  readonly repo: RepoRecord;
  readonly pull: PullRequestRecord;
};

function baseRepositoryOf(ref: PullRequestRef, answer: unknown): RepoRecord {
  const shape = withBaseRepository.safeParse(answer);
  const repo = shape.success ? repoFromRest(shape.data.base.repo) : null;
  if (repo === null || !sameRepository(repo.fullName, ref.repo)) {
    throw new GitHubRefreshError('malformed_response');
  }
  return repo;
}

function pullOf(ref: PullRequestRef, answer: unknown): Reread {
  const repo = baseRepositoryOf(ref, answer);
  const batch = factsFromPull(repo, answer);
  const pull = batch?.pullRequests[0];
  if (batch === null || pull === undefined || pull.number !== ref.number) {
    throw new GitHubRefreshError('malformed_response');
  }
  return { batch, repo, pull };
}

async function readAgain(reads: GitHubReads, ref: PullRequestRef): Promise<FactBatch | null> {
  const answer = await reads.pullRequest(ref.repo, ref.number);
  if (!answer.ok && answer.failure === 'not_found') return null;
  const { batch, repo, pull } = pullOf(ref, answered(answer));
  const reviews = answered(await reads.pullRequestReviews(ref.repo, ref.number));
  const runs = answered(await reads.checkRuns(ref.repo, pull.headSha));
  return {
    ...batch,
    reviews: reviewsFromRest(repo, pull.githubId, reviews),
    checkRuns: checkRunsFromRest(repo.githubId, runs),
  };
}

export async function refreshPullRequest(
  reads: GitHubReads,
  db: Database,
  ref: PullRequestRef,
  freshAt: Date,
): Promise<PullRequestFacts | null> {
  const batch = await readAgain(reads, ref);
  if (batch === null) return null;
  const report = await upsertFacts(db, batch, freshAt);
  for (const pull of report.pullRequests) {
    if (!pull.filesKnown) await fetchFilesAtHead(reads, db, pull);
  }
  return pullRequestFacts(db, ref);
}
