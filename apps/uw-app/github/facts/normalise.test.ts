import { describe, expect, it } from 'vitest';
import { reviewBody } from '@uw/harness';
import checkRunCompleted from '../fixtures/check-run-completed.json' with { type: 'json' };
import issuesLabeled from '../fixtures/issues-labeled.json' with { type: 'json' };
import issuesUnlabeled from '../fixtures/issues-unlabeled.json' with { type: 'json' };
import pullRequestEdited from '../fixtures/pull-request-edited.json' with { type: 'json' };
import pullRequestOpened from '../fixtures/pull-request-opened.json' with { type: 'json' };
import reviewDismissed from '../fixtures/pull-request-review-dismissed.json' with { type: 'json' };
import reviewSubmitted from '../fixtures/pull-request-review-submitted.json' with { type: 'json' };
import pullRequestSynchronize from '../fixtures/pull-request-synchronize.json' with { type: 'json' };
import push from '../fixtures/push.json' with { type: 'json' };
import restCheckRuns from '../fixtures/rest-check-runs.json' with { type: 'json' };
import restFiles from '../fixtures/rest-files.json' with { type: 'json' };
import restRepositories from '../fixtures/rest-installation-repositories.json' with { type: 'json' };
import restIssues from '../fixtures/rest-issues.json' with { type: 'json' };
import restPull from '../fixtures/rest-pull.json' with { type: 'json' };
import restReviews from '../fixtures/rest-reviews.json' with { type: 'json' };
import {
  base,
  completedCheck,
  head,
  labelledIssue,
  milestone,
  nextHead,
  openedPull,
  repo,
  submittedReview,
} from '../testing/facts-fixtures.ts';
import {
  checkRunsFromRest,
  factsFromPull,
  factsFromWebhook,
  filesFromRest,
  issuesFromRest,
  repoFromRest,
  reviewsFromRest,
} from './normalise.ts';
import { emptyBatch, type FactBatch } from './records.ts';

function batchOf(parts: Partial<FactBatch>) {
  return { kind: 'facts', batch: { ...emptyBatch, repos: [repo], ...parts } };
}

const synchronized = {
  ...openedPull,
  headSha: nextHead,
  githubUpdatedAt: new Date('2026-10-02T08:30:00.000Z'),
};

describe('GH-2 GitHub issue and pull request webhooks become fact records', () => {
  it('carries the repository, the issue and its milestone from a labelled issue', () => {
    expect(factsFromWebhook('issues', issuesLabeled)).toEqual(
      batchOf({ milestones: [milestone], issues: [labelledIssue] }),
    );
  });

  it('carries the issue without the label from an unlabelled issue', () => {
    const unlabelled = {
      ...labelledIssue,
      labels: [],
      githubUpdatedAt: new Date('2026-10-02T08:05:00.000Z'),
    };
    expect(factsFromWebhook('issues', issuesUnlabeled)).toEqual(
      batchOf({ milestones: [milestone], issues: [unlabelled] }),
    );
  });

  it('carries the pull request with its declaration from an opened pull request', () => {
    expect(factsFromWebhook('pull_request', pullRequestOpened)).toEqual(
      batchOf({ pullRequests: [openedPull] }),
    );
  });

  it('carries the new head from a synchronize', () => {
    expect(factsFromWebhook('pull_request', pullRequestSynchronize)).toEqual(
      batchOf({ pullRequests: [synchronized] }),
    );
  });

  it('records two harness blocks as an ambiguous declaration', () => {
    const edited = {
      ...synchronized,
      declaration: null,
      declarationProblem: 'ambiguous_block',
      githubUpdatedAt: new Date('2026-10-02T08:40:00.000Z'),
    };
    expect(factsFromWebhook('pull_request', pullRequestEdited)).toEqual(
      batchOf({ pullRequests: [edited] }),
    );
  });
});

describe('GH-2 GitHub review, check run and push webhooks become fact records', () => {
  it('carries the repository, the pull request and the review with its provider', () => {
    const pull = { ...openedPull, githubUpdatedAt: new Date('2026-10-02T08:10:00.000Z') };
    expect(factsFromWebhook('pull_request_review', reviewSubmitted)).toEqual(
      batchOf({ pullRequests: [pull], reviews: [submittedReview] }),
    );
  });

  it('carries a dismissed review as dismissed', () => {
    const pull = { ...openedPull, githubUpdatedAt: new Date('2026-10-02T08:20:00.000Z') };
    expect(factsFromWebhook('pull_request_review', reviewDismissed)).toEqual(
      batchOf({ pullRequests: [pull], reviews: [{ ...submittedReview, state: 'dismissed' }] }),
    );
  });

  it('carries the check run from a completed check run', () => {
    expect(factsFromWebhook('check_run', checkRunCompleted)).toEqual(
      batchOf({ checkRuns: [completedCheck] }),
    );
  });

  it('carries only the repository from a push', () => {
    expect(factsFromWebhook('push', push)).toEqual(batchOf({}));
  });
});

const reviewedBody = reviewBody({
  provider: 'anthropic',
  model: 'claude',
  verdict: 'request_changes',
  findings: ['The lease is not renewed', 'A typo in the copy'],
});

describe('Reviewer findings in a review payload', () => {
  it("a review payload's findings are parsed from its body", () => {
    const payload = {
      ...reviewSubmitted,
      review: { ...reviewSubmitted.review, body: reviewedBody },
    };
    const delivered = factsFromWebhook('pull_request_review', payload);
    const reviews = delivered.kind === 'facts' ? delivered.batch.reviews : [];
    expect(reviews.map((review) => review.findings)).toEqual([
      ['The lease is not renewed', 'A typo in the copy'],
    ]);
    expect(reviewsFromRest(repo, openedPull.githubId, restReviews)[0]?.findings).toEqual([]);
  });
});

describe('GitHub deliveries that carry no facts', () => {
  it('ignores an event it does not read', () => {
    expect(factsFromWebhook('ping', { zen: 'Keep it simple.' })).toEqual({
      kind: 'ignored',
      event: 'ping',
    });
  });

  it('counts an issues delivery without its issue as malformed', () => {
    const withoutIssue: Record<string, unknown> = { ...issuesLabeled };
    delete withoutIssue.issue;
    expect(factsFromWebhook('issues', withoutIssue)).toEqual({
      kind: 'malformed',
      event: 'issues',
    });
  });

  it('counts a repository name GitHub could not have sent as malformed', () => {
    const repository = { ...push.repository, full_name: '../uw-platform' };
    expect(factsFromWebhook('push', { ...push, repository })).toEqual({
      kind: 'malformed',
      event: 'push',
    });
  });
});

function pullFromHead(repository: unknown) {
  const pull = pullRequestOpened.pull_request;
  const pullRequest = { ...pull, head: { ...pull.head, repo: repository } };
  return factsFromWebhook('pull_request', { ...pullRequestOpened, pull_request: pullRequest });
}

describe('GH-2 a pull request carries the repository its head lives in', () => {
  it('carries a fork head as the fork repository', () => {
    expect(pullFromHead({ full_name: 'someone/uw-platform' })).toEqual(
      batchOf({ pullRequests: [{ ...openedPull, headRepo: 'someone/uw-platform' }] }),
    );
  });

  it('carries a deleted fork or an unusable repository name as no head repository', () => {
    for (const repository of [null, { full_name: '../x' }]) {
      expect(pullFromHead(repository)).toEqual(
        batchOf({ pullRequests: [{ ...openedPull, headRepo: null }] }),
      );
    }
  });
});

describe('GitHub deliveries with a value the read model cannot store', () => {
  it('counts a pull request whose base is not a full SHA as malformed', () => {
    const pull = pullRequestOpened.pull_request;
    const pullRequest = { ...pull, base: { ...pull.base, sha: 'main' } };
    expect(
      factsFromWebhook('pull_request', { ...pullRequestOpened, pull_request: pullRequest }),
    ).toEqual({
      kind: 'malformed',
      event: 'pull_request',
    });
  });

  it('counts a NUL in a stored string as malformed', () => {
    const pull = pullRequestOpened.pull_request;
    const titled = { ...pull, title: 'Show\u0000the board' };
    const branched = { ...pull, head: { ...pull.head, ref: 'harness/\u0000' } };
    for (const pullRequest of [titled, branched]) {
      expect(
        factsFromWebhook('pull_request', { ...pullRequestOpened, pull_request: pullRequest }),
      ).toMatchObject({ kind: 'malformed' });
    }
    const label = { ...issuesLabeled.issue, labels: [{ name: 'har\u0000ness' }] };
    expect(factsFromWebhook('issues', { ...issuesLabeled, issue: label })).toMatchObject({
      kind: 'malformed',
    });
  });

  it('counts a pull request with an abbreviated head as malformed', () => {
    const pullRequest = {
      ...pullRequestOpened.pull_request,
      head: { ...pullRequestOpened.pull_request.head, sha: 'c0ffee' },
    };
    expect(
      factsFromWebhook('pull_request', { ...pullRequestOpened, pull_request: pullRequest }),
    ).toEqual({ kind: 'malformed', event: 'pull_request' });
  });
});

describe('GH-2 GitHub REST answers become fact records', () => {
  it('reads an approved review in either case and drops pending and unusable reviews', () => {
    expect(reviewsFromRest(repo, openedPull.githubId, restReviews)).toEqual([submittedReview]);
  });

  it('reads a pull request with its repository', () => {
    expect(factsFromPull(repo, restPull)).toEqual({
      ...emptyBatch,
      repos: [repo],
      pullRequests: [openedPull],
    });
  });

  it('reads nothing from a pull request answer of the wrong shape', () => {
    expect(factsFromPull(repo, { id: 1 })).toBeNull();
  });

  it('reads the check runs at a head', () => {
    expect(checkRunsFromRest(repo.githubId, restCheckRuns.check_runs)).toEqual([completedCheck]);
  });

  it('reads issues with their milestones and names the pull requests among them', () => {
    expect(issuesFromRest(repo, restIssues)).toEqual({
      issues: [labelledIssue],
      milestones: [milestone],
      pullRequestNumbers: [7],
    });
  });

  it('reads the installation repositories and refuses one of the wrong shape', () => {
    const [listed] = restRepositories.repositories;
    expect(repoFromRest(listed)).toEqual(repo);
    expect(repoFromRest({ ...listed, full_name: 'no-owner' })).toBeNull();
  });
});

describe('GH-5 the changed files at a head include the previous names of renames', () => {
  it('lists every filename and every previous filename once, in first-seen order', () => {
    expect(filesFromRest(openedPull.githubId, { head, base }, restFiles.files)).toEqual({
      pullRequestId: openedPull.githubId,
      head,
      base,
      paths: ['apps/uw-app/board.tsx', 'apps/uw-app/board/view.tsx', 'apps/uw-app/view.tsx'],
      problem: null,
    });
  });

  it('records too many files as a problem with no paths', () => {
    expect(filesFromRest(openedPull.githubId, { head, base }, 'too_many_files')).toEqual({
      pullRequestId: openedPull.githubId,
      head,
      base,
      paths: null,
      problem: 'too_many_files',
    });
  });

  it('records a file entry of the wrong shape as a problem with no paths', () => {
    expect(filesFromRest(openedPull.githubId, { head, base }, [{ status: 'added' }])).toEqual({
      pullRequestId: openedPull.githubId,
      head,
      base,
      paths: null,
      problem: 'malformed_files',
    });
  });
});

describe('a check value outside the stored closed sets never reaches a CHECK constraint', () => {
  const run = restCheckRuns.check_runs[0];

  it('reads an unknown conclusion as a failure', () => {
    const [record] = checkRunsFromRest(repo.githubId, [{ ...run, conclusion: 'startup_failure' }]);
    expect(record?.conclusion).toBe('failure');
  });

  it('reads an unknown status as pending', () => {
    const [record] = checkRunsFromRest(repo.githubId, [
      { ...run, status: 'warming_up', conclusion: null },
    ]);
    expect(record).toEqual({ ...completedCheck, status: 'pending', conclusion: null });
  });

  it('drops a check run whose head is not a full SHA', () => {
    expect(checkRunsFromRest(repo.githubId, [{ ...run, head_sha: 'c0ffee' }])).toEqual([]);
  });
});

describe('GL-3 the facts carry the requested reviewers', () => {
  it('reads the requested logins from a pull request, once each, and none when absent', () => {
    const requested = {
      ...restPull,
      requested_reviewers: [
        { login: 'uw-reviewer[bot]' },
        { login: 'seth-k' },
        { login: 'seth-k' },
      ],
    };
    expect(factsFromPull(repo, requested)?.pullRequests[0]?.requestedReviewers).toEqual([
      'uw-reviewer[bot]',
      'seth-k',
    ]);
    expect(factsFromPull(repo, restPull)?.pullRequests[0]?.requestedReviewers).toEqual([]);
  });
});
