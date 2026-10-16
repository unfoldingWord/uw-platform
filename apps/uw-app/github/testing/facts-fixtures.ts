import type { PullRequestDeclaration } from '@uw/contracts';
import type {
  CheckRunRecord,
  IssueRecord,
  MilestoneRecord,
  PullRequestRecord,
  RepoRecord,
  ReviewRecord,
} from '../facts/records.ts';

export const head = `c0ffee${'0'.repeat(34)}`;
export const nextHead = `beef${'0'.repeat(36)}`;
export const base = '0'.repeat(40);
export const headRef = 'harness/b1000000-0000-4000-8000-000000000002';

export const repo: RepoRecord = {
  githubId: 9100000001,
  fullName: 'unfoldingWord/uw-platform',
  defaultBranch: 'main',
  private: true,
};

export const milestone: MilestoneRecord = {
  githubId: 9100000501,
  repoId: repo.githubId,
  number: 1,
  title: 'Step 5',
  state: 'open',
  dueOn: new Date('2026-10-31T00:00:00.000Z'),
  githubUpdatedAt: new Date('2026-10-02T07:00:00.000Z'),
};

export const labelledIssue: IssueRecord = {
  githubId: 9100000101,
  repoId: repo.githubId,
  number: 12,
  title: 'Show the board',
  state: 'open',
  labels: ['harness'],
  milestoneId: milestone.githubId,
  githubUpdatedAt: new Date('2026-10-02T08:00:00.000Z'),
};

export const declaration: PullRequestDeclaration = {
  closes: ['#12'],
  risks: 'the board renders slower on phones',
  touches: 'apps/uw-app/board',
  riskTier: 'standard',
  riskDomains: [],
};

export const openedPull: PullRequestRecord = {
  githubId: 9100000201,
  repoId: repo.githubId,
  number: 7,
  title: 'Show the board',
  state: 'open',
  draft: false,
  headSha: head,
  headRef,
  headRepo: 'unfoldingWord/uw-platform',
  baseRef: 'main',
  baseSha: base,
  milestoneId: null,
  requestedReviewers: [],
  declaration,
  declarationProblem: null,
  githubUpdatedAt: new Date('2026-10-02T08:00:00.000Z'),
};

export const submittedReview: ReviewRecord = {
  githubId: 9100000301,
  repoId: repo.githubId,
  pullRequestId: openedPull.githubId,
  reviewerLogin: 'uw-reviewer[bot]',
  commitId: head,
  state: 'approved',
  provider: 'anthropic',
  findings: [],
  submittedAt: new Date('2026-10-02T08:10:00.000Z'),
};

export const completedCheck: CheckRunRecord = {
  githubId: 9100000401,
  repoId: repo.githubId,
  headSha: head,
  name: 'test',
  appSlug: 'github-actions',
  status: 'completed',
  conclusion: 'success',
  startedAt: new Date('2026-10-02T08:01:00.000Z'),
  completedAt: new Date('2026-10-02T08:05:00.000Z'),
};

export const changedPaths: readonly string[] = [
  'apps/uw-app/board.tsx',
  'apps/uw-app/board/view.tsx',
  'apps/uw-app/view.tsx',
];
