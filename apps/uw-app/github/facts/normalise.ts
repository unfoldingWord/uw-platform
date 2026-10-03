import type { z } from 'zod';
import { checkConclusionSchema, repositorySchema as repositoryName } from '@uw/contracts';
import {
  fullSha,
  parseDeclaration,
  parseReviewFindings,
  parseReviewProvider,
  type CheckConclusion,
  type ReviewState,
} from '@uw/harness';
import {
  checkRunEventSchema,
  checkRunSchema,
  fileSchema,
  issueSchema,
  issuesEventSchema,
  milestoneSchema,
  pullRequestEventSchema,
  pullSchema,
  pushEventSchema,
  repositorySchema,
  reviewEventSchema,
  reviewSchema,
} from '../payloads.ts';
import {
  emptyBatch,
  type CheckRunRecord,
  type FactBatch,
  type FilesRecord,
  type GithubCheckStatus,
  type IssueRecord,
  type MilestoneRecord,
  type PullRequestRecord,
  type RepoRecord,
  type ReviewRecord,
} from './records.ts';

export type NormalisedDelivery =
  | { readonly kind: 'facts'; readonly batch: FactBatch }
  | { readonly kind: 'ignored'; readonly event: string }
  | { readonly kind: 'malformed'; readonly event: string };

type Milestone = z.infer<typeof milestoneSchema>;
type Pull = z.infer<typeof pullSchema>;

const statuses: ReadonlyMap<string, GithubCheckStatus> = new Map(
  (['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'] as const).map(
    (status) => [status, status],
  ),
);
const conclusions: ReadonlyMap<string, CheckConclusion> = new Map(
  checkConclusionSchema.options.map((conclusion) => [conclusion, conclusion]),
);
const reviewStates: ReadonlyMap<string, ReviewState> = new Map(
  (['approved', 'changes_requested', 'commented', 'dismissed'] as const).map((state) => [
    state,
    state,
  ]),
);
const unknownStatus: GithubCheckStatus = 'pending';
const unknownConclusion: CheckConclusion = 'failure';

function repoOf(repository: z.infer<typeof repositorySchema>): RepoRecord {
  return {
    githubId: repository.id,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
    private: repository.private,
  };
}

function milestoneOf(repoId: number, milestone: Milestone): MilestoneRecord {
  return {
    githubId: milestone.id,
    repoId,
    number: milestone.number,
    title: milestone.title,
    state: milestone.state,
    dueOn: milestone.due_on ?? null,
    githubUpdatedAt: milestone.updated_at,
  };
}

function milestonesOf(repoId: number, milestone: Milestone | null | undefined) {
  return milestone ? [milestoneOf(repoId, milestone)] : [];
}

function issueOf(repoId: number, issue: z.infer<typeof issueSchema>): IssueRecord {
  return {
    githubId: issue.id,
    repoId,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels.map((label) => label.name),
    milestoneId: issue.milestone?.id ?? null,
    githubUpdatedAt: issue.updated_at,
  };
}

function declarationOf(body: string | null | undefined) {
  const parsed = parseDeclaration(body ?? null);
  return parsed.ok
    ? { declaration: parsed.declaration, declarationProblem: null }
    : { declaration: null, declarationProblem: parsed.problem };
}

function headRepositoryOf(pull: Pull): string | null {
  const parsed = repositoryName.safeParse(pull.head.repo?.full_name);
  return parsed.success ? parsed.data : null;
}

function pullOf(repoId: number, pull: Pull): PullRequestRecord | null {
  const headSha = fullSha(pull.head.sha);
  const baseSha = fullSha(pull.base.sha);
  if (headSha === null || baseSha === null) return null;
  const merged = pull.merged === true || Boolean(pull.merged_at);
  return {
    githubId: pull.id,
    repoId,
    number: pull.number,
    title: pull.title,
    state: merged ? 'merged' : pull.state,
    draft: pull.draft ?? false,
    headSha,
    headRef: pull.head.ref,
    headRepo: headRepositoryOf(pull),
    baseRef: pull.base.ref,
    baseSha,
    milestoneId: pull.milestone?.id ?? null,
    ...declarationOf(pull.body),
    githubUpdatedAt: pull.updated_at,
  };
}

function reviewOf(
  repoId: number,
  pullRequestId: number,
  review: z.infer<typeof reviewSchema>,
): ReviewRecord | null {
  const commitId = fullSha(review.commit_id ?? '');
  const state = reviewStates.get(review.state.toLowerCase());
  if (commitId === null || state === undefined || review.user === null) return null;
  return {
    githubId: review.id,
    repoId,
    pullRequestId,
    reviewerLogin: review.user.login,
    commitId,
    state,
    provider: parseReviewProvider(review.body ?? null),
    findings: parseReviewFindings(review.body ?? null),
    submittedAt: review.submitted_at ?? null,
  };
}

function conclusionOf(conclusion: string | null): CheckConclusion | null {
  if (conclusion === null) return null;
  return conclusions.get(conclusion) ?? unknownConclusion;
}

function checkOf(repoId: number, run: z.infer<typeof checkRunSchema>): CheckRunRecord | null {
  const headSha = fullSha(run.head_sha);
  if (headSha === null) return null;
  return {
    githubId: run.id,
    repoId,
    headSha,
    name: run.name,
    appSlug: run.app?.slug ?? null,
    status: statuses.get(run.status) ?? unknownStatus,
    conclusion: conclusionOf(run.conclusion),
    startedAt: run.started_at ?? null,
    completedAt: run.completed_at ?? null,
  };
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

function eachParsed<T>(schema: z.ZodType<T>, values: readonly unknown[]): readonly T[] {
  return values.flatMap((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function pullBatch(repo: RepoRecord, pull: Pull): FactBatch | null {
  const record = pullOf(repo.githubId, pull);
  if (record === null) return null;
  return {
    ...emptyBatch,
    repos: [repo],
    milestones: milestonesOf(repo.githubId, pull.milestone),
    pullRequests: [record],
  };
}

type Reader = (payload: unknown) => FactBatch | null;

function reading<T>(schema: z.ZodType<T>, read: (parsed: T) => FactBatch | null): Reader {
  return (payload) => {
    const parsed = schema.safeParse(payload);
    return parsed.success ? read(parsed.data) : null;
  };
}

const readers: ReadonlyMap<string, Reader> = new Map([
  [
    'issues',
    reading(issuesEventSchema, ({ repository, issue }) => {
      const repo = repoOf(repository);
      return {
        ...emptyBatch,
        repos: [repo],
        milestones: milestonesOf(repo.githubId, issue.milestone),
        issues: issue.pull_request ? [] : [issueOf(repo.githubId, issue)],
      };
    }),
  ],
  [
    'pull_request',
    reading(pullRequestEventSchema, (event) =>
      pullBatch(repoOf(event.repository), event.pull_request),
    ),
  ],
  [
    'pull_request_review',
    reading(reviewEventSchema, ({ repository, pull_request: pull, review }) => {
      const batch = pullBatch(repoOf(repository), pull);
      if (batch === null) return null;
      const record = reviewOf(repository.id, pull.id, review);
      return { ...batch, reviews: record ? [record] : [] };
    }),
  ],
  [
    'check_run',
    reading(checkRunEventSchema, ({ repository, check_run: run }) => {
      const record = checkOf(repository.id, run);
      return { ...emptyBatch, repos: [repoOf(repository)], checkRuns: record ? [record] : [] };
    }),
  ],
  [
    'push',
    reading(pushEventSchema, ({ repository }) => ({ ...emptyBatch, repos: [repoOf(repository)] })),
  ],
]);

export function factsFromWebhook(event: string, payload: unknown): NormalisedDelivery {
  const read = readers.get(event);
  if (read === undefined) return { kind: 'ignored', event };
  const batch = read(payload);
  return batch === null ? { kind: 'malformed', event } : { kind: 'facts', batch };
}

export function factsFromPull(repo: RepoRecord, pull: unknown): FactBatch | null {
  const parsed = pullSchema.safeParse(pull);
  return parsed.success ? pullBatch(repo, parsed.data) : null;
}

export function filesFromRest(
  pullRequestId: number,
  compared: { readonly head: string; readonly base: string },
  files: readonly unknown[] | 'too_many_files',
): FilesRecord {
  const { head, base } = compared;
  if (files === 'too_many_files') return { pullRequestId, head, base, paths: null, problem: files };
  const parsed = fileSchema.array().safeParse(files);
  if (!parsed.success) {
    return { pullRequestId, head, base, paths: null, problem: 'malformed_files' };
  }
  const paths = parsed.data.flatMap((file) =>
    file.previous_filename === undefined
      ? [file.filename]
      : [file.filename, file.previous_filename],
  );
  return { pullRequestId, head, base, paths: [...new Set(paths)], problem: null };
}

export function reviewsFromRest(
  repo: RepoRecord,
  pullRequestId: number,
  reviews: readonly unknown[],
): readonly ReviewRecord[] {
  return eachParsed(reviewSchema, reviews)
    .map((review) => reviewOf(repo.githubId, pullRequestId, review))
    .filter(present);
}

export function checkRunsFromRest(
  repoId: number,
  runs: readonly unknown[],
): readonly CheckRunRecord[] {
  return eachParsed(checkRunSchema, runs)
    .map((run) => checkOf(repoId, run))
    .filter(present);
}

export function issuesFromRest(repo: RepoRecord, issues: readonly unknown[]) {
  const listed = eachParsed(issueSchema, issues);
  const milestones = new Map<number, MilestoneRecord>();
  for (const issue of listed) {
    if (issue.milestone)
      milestones.set(issue.milestone.id, milestoneOf(repo.githubId, issue.milestone));
  }
  return {
    issues: listed
      .filter((issue) => !issue.pull_request)
      .map((issue) => issueOf(repo.githubId, issue)),
    milestones: [...milestones.values()],
    pullRequestNumbers: listed.filter((issue) => issue.pull_request).map((issue) => issue.number),
  };
}

export function repoFromRest(repo: unknown): RepoRecord | null {
  const parsed = repositorySchema.safeParse(repo);
  return parsed.success ? repoOf(parsed.data) : null;
}
