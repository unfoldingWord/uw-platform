import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { checkConclusionSchema } from '@uw/contracts';
import { FULL_SHA_PATTERN, REPOSITORY_PATTERN, matches, oneOf } from './checks.ts';
import { instant } from './columns.ts';
import { declareTable } from './declarations.ts';

const githubIssueStates = ['open', 'closed'] as const;
const githubPullRequestStates = ['open', 'closed', 'merged'] as const;
const githubCheckStatuses = [
  'queued',
  'in_progress',
  'completed',
  'waiting',
  'requested',
  'pending',
] as const;
const githubReviewStates = ['approved', 'changes_requested', 'commented', 'dismissed'] as const;

const readModel = { classification: 'internal', offlineEligibility: 'cache_readonly' } as const;
const githubId = (name: string) => bigint(name, { mode: 'number' });
const emptyText = sql`'{}'::text[]`;

export const ghRepos = declareTable(
  'gh_repos',
  {
    githubId: githubId('github_id').primaryKey(),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull(),
    private: boolean('private').notNull(),
    sweptThrough: instant('swept_through'),
    lastSweep: jsonb('last_sweep'),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    check('gh_repos_full_name_form', matches(t.fullName, REPOSITORY_PATTERN)),
    uniqueIndex('gh_repos_full_name_once').on(sql`lower(${t.fullName})`),
  ],
);

export const ghMilestones = declareTable(
  'gh_milestones',
  {
    githubId: githubId('github_id').primaryKey(),
    repoId: githubId('repo_id')
      .notNull()
      .references(() => ghRepos.githubId),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    dueOn: instant('due_on'),
    githubUpdatedAt: instant('github_updated_at').notNull(),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    unique('gh_milestones_repo_number').on(t.repoId, t.number),
    check('gh_milestones_state_known', oneOf(t.state, githubIssueStates)),
  ],
);

export const ghIssues = declareTable(
  'gh_issues',
  {
    githubId: githubId('github_id').primaryKey(),
    repoId: githubId('repo_id')
      .notNull()
      .references(() => ghRepos.githubId),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    labels: text('labels').array().notNull().default(emptyText),
    milestoneId: githubId('milestone_id'),
    githubUpdatedAt: instant('github_updated_at').notNull(),
    xrefClaimedAt: instant('xref_claimed_at'),
    xrefCommentId: githubId('xref_comment_id'),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    unique('gh_issues_repo_number').on(t.repoId, t.number),
    check('gh_issues_state_known', oneOf(t.state, githubIssueStates)),
  ],
);

export const ghPrs = declareTable(
  'gh_prs',
  {
    githubId: githubId('github_id').primaryKey(),
    repoId: githubId('repo_id')
      .notNull()
      .references(() => ghRepos.githubId),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    draft: boolean('draft').notNull(),
    headSha: text('head_sha').notNull(),
    headRef: text('head_ref').notNull(),
    baseRef: text('base_ref').notNull(),
    milestoneId: githubId('milestone_id'),
    declaration: jsonb('declaration'),
    declarationProblem: text('declaration_problem'),
    files: jsonb('files'),
    filesHead: text('files_head'),
    filesProblem: text('files_problem'),
    githubUpdatedAt: instant('github_updated_at').notNull(),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    unique('gh_prs_repo_number').on(t.repoId, t.number),
    check('gh_prs_state_known', oneOf(t.state, githubPullRequestStates)),
    check('gh_prs_head_sha_form', matches(t.headSha, FULL_SHA_PATTERN)),
    check('gh_prs_files_head_form', matches(t.filesHead, FULL_SHA_PATTERN)),
    check(
      'gh_prs_one_declaration_outcome',
      sql`${t.declaration} IS NULL OR ${t.declarationProblem} IS NULL`,
    ),
  ],
);

export const ghCheckRuns = declareTable(
  'gh_check_runs',
  {
    githubId: githubId('github_id').primaryKey(),
    repoId: githubId('repo_id')
      .notNull()
      .references(() => ghRepos.githubId),
    headSha: text('head_sha').notNull(),
    name: text('name').notNull(),
    appSlug: text('app_slug'),
    status: text('status').notNull(),
    conclusion: text('conclusion'),
    startedAt: instant('started_at'),
    completedAt: instant('completed_at'),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    index('gh_check_runs_head').on(t.repoId, t.headSha),
    check('gh_check_runs_head_sha_form', matches(t.headSha, FULL_SHA_PATTERN)),
    check('gh_check_runs_status_known', oneOf(t.status, githubCheckStatuses)),
    check('gh_check_runs_conclusion_known', oneOf(t.conclusion, checkConclusionSchema.options)),
  ],
);

export const ghReviews = declareTable(
  'gh_reviews',
  {
    githubId: githubId('github_id').primaryKey(),
    repoId: githubId('repo_id')
      .notNull()
      .references(() => ghRepos.githubId),
    prId: githubId('pr_id')
      .notNull()
      .references(() => ghPrs.githubId),
    reviewerLogin: text('reviewer_login').notNull(),
    commitId: text('commit_id').notNull(),
    state: text('state').notNull(),
    provider: text('provider'),
    submittedAt: instant('submitted_at'),
    freshAt: instant('fresh_at').notNull(),
  },
  readModel,
  (t) => [
    index('gh_reviews_pr').on(t.prId),
    check('gh_reviews_commit_id_form', matches(t.commitId, FULL_SHA_PATTERN)),
    check('gh_reviews_state_known', oneOf(t.state, githubReviewStates)),
  ],
);
