import { z } from 'zod';
import type { Logger } from '@uw/core/log';
import type { Database } from '@uw/db/client';
import {
  FactsUnavailableError,
  sameRepository,
  type PullRequestFacts,
  type PullRequestRef,
} from '@uw/harness';
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

export type GitHubAccess = { readonly open: OpenReads; readonly logger: Logger };

type Step = 'pull_request' | 'reviews' | 'check_runs' | 'files';

class GitHubRefreshError extends FactsUnavailableError {
  readonly step: Step;
  readonly status: number | null;

  constructor(step: Step, failure: GitHubFailure, status: number | null) {
    super(failure);
    this.name = 'GitHubRefreshError';
    this.step = step;
    this.status = status;
  }
}

const withBaseRepository = z.object({ base: z.object({ repo: z.unknown() }) });

function answered<T>(result: GitHubResult<T>, step: Step): T {
  if (!result.ok) throw new GitHubRefreshError(step, result.failure, result.status);
  return result.value;
}

const malformed = () => new GitHubRefreshError('pull_request', 'malformed_response', null);

type Reread = {
  readonly batch: FactBatch;
  readonly repo: RepoRecord;
  readonly pull: PullRequestRecord;
};

function baseRepositoryOf(ref: PullRequestRef, answer: unknown): RepoRecord {
  const shape = withBaseRepository.safeParse(answer);
  const repo = shape.success ? repoFromRest(shape.data.base.repo) : null;
  if (repo === null || !sameRepository(repo.fullName, ref.repo)) {
    throw malformed();
  }
  return repo;
}

function pullOf(ref: PullRequestRef, answer: unknown): Reread {
  const repo = baseRepositoryOf(ref, answer);
  const batch = factsFromPull(repo, answer);
  const pull = batch?.pullRequests[0];
  if (batch === null || pull === undefined || pull.number !== ref.number) {
    throw malformed();
  }
  return { batch, repo, pull };
}

async function readAgain(reads: GitHubReads, ref: PullRequestRef): Promise<FactBatch | null> {
  const answer = await reads.pullRequest(ref.repo, ref.number);
  if (!answer.ok && answer.failure === 'not_found') return null;
  const { batch, repo, pull } = pullOf(ref, answered(answer, 'pull_request'));
  const reviews = answered(await reads.pullRequestReviews(ref.repo, ref.number), 'reviews');
  const runs = answered(await reads.checkRuns(ref.repo, pull.headSha), 'check_runs');
  return {
    ...batch,
    reviews: reviewsFromRest(repo, pull.githubId, reviews),
    checkRuns: checkRunsFromRest(repo.githubId, runs),
  };
}

async function readFrom(
  reads: GitHubReads,
  db: Database,
  ref: PullRequestRef,
  freshAt: Date,
): Promise<PullRequestFacts | null> {
  const batch = await readAgain(reads, ref);
  if (batch === null) return null;
  const report = await upsertFacts(db, batch, freshAt);
  for (const pull of report.pullRequests) {
    if (pull.filesKnown) continue;
    answered(await fetchFilesAtHead(reads, db, pull), 'files');
  }
  return pullRequestFacts(db, ref);
}

function logged(logger: Logger, ref: PullRequestRef, error: GitHubRefreshError): void {
  const files = error.step === 'files';
  logger.warn(
    files ? 'changed files not read again from GitHub' : 'pull request not read again from GitHub',
    {
      outcome: files ? 'files_not_fetched' : 'refresh_failed',
      step: error.step,
      failure: error.failure,
      status: error.status,
      repository: ref.repo,
      pull_request: ref.number,
    },
  );
}

export async function refreshPullRequest(
  github: GitHubAccess,
  db: Database,
  ref: PullRequestRef,
  freshAt: Date,
): Promise<PullRequestFacts | null> {
  try {
    return await readFrom(github.open(), db, ref, freshAt);
  } catch (error) {
    if (error instanceof GitHubRefreshError) logged(github.logger, ref, error);
    throw error;
  }
}
