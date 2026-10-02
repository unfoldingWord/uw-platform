import type { PullRequestDeclaration } from '@uw/contracts';
import type { CheckConclusion, ReviewState } from '@uw/harness';

export type GithubCheckStatus =
  'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';

export type RepoRecord = {
  readonly githubId: number;
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
};

export type MilestoneRecord = {
  readonly githubId: number;
  readonly repoId: number;
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly dueOn: Date | null;
  readonly githubUpdatedAt: Date;
};

export type IssueRecord = {
  readonly githubId: number;
  readonly repoId: number;
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
  readonly labels: readonly string[];
  readonly milestoneId: number | null;
  readonly githubUpdatedAt: Date;
};

export type PullRequestRecord = {
  readonly githubId: number;
  readonly repoId: number;
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed' | 'merged';
  readonly draft: boolean;
  readonly headSha: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly milestoneId: number | null;
  readonly declaration: PullRequestDeclaration | null;
  readonly declarationProblem: string | null;
  readonly githubUpdatedAt: Date;
};

export type FilesRecord = {
  readonly pullRequestId: number;
  readonly head: string;
  readonly paths: readonly string[] | null;
  readonly problem: string | null;
};

export type CheckRunRecord = {
  readonly githubId: number;
  readonly repoId: number;
  readonly headSha: string;
  readonly name: string;
  readonly appSlug: string | null;
  readonly status: GithubCheckStatus;
  readonly conclusion: CheckConclusion | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
};

export type ReviewRecord = {
  readonly githubId: number;
  readonly repoId: number;
  readonly pullRequestId: number;
  readonly reviewerLogin: string;
  readonly commitId: string;
  readonly state: ReviewState;
  readonly provider: string | null;
  readonly submittedAt: Date | null;
};

export type FactBatch = {
  readonly repos: readonly RepoRecord[];
  readonly milestones: readonly MilestoneRecord[];
  readonly issues: readonly IssueRecord[];
  readonly pullRequests: readonly PullRequestRecord[];
  readonly files: readonly FilesRecord[];
  readonly checkRuns: readonly CheckRunRecord[];
  readonly reviews: readonly ReviewRecord[];
};

export const emptyBatch: FactBatch = {
  repos: [],
  milestones: [],
  issues: [],
  pullRequests: [],
  files: [],
  checkRuns: [],
  reviews: [],
};
