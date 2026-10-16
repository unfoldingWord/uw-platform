import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  checkConclusionSchema,
  closingRefSchema,
  pullRequestDeclarationSchema,
  readFindingSchema,
} from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { ghCheckRuns, ghIssues, ghPrs, ghRepos, ghReviews } from '@uw/db/schema';
import type {
  BaseComparison,
  ChangedFiles,
  CheckFact,
  PullRequestFacts,
  PullRequestRef,
  ReviewFact,
} from '@uw/harness';
import { HARNESS_LABEL } from '../harness-label.ts';
import type { IssueChange } from './records.ts';
import { issueChangeOf } from './issues.ts';

export type PullRequestChange = {
  readonly repo: string;
  readonly githubId: number;
  readonly number: number;
  readonly head: string;
  readonly baseSha: string;
  readonly title: string;
  readonly open: boolean;
  readonly requestedReviewers: readonly string[];
  readonly filesKnown: boolean;
};

type PullRow = typeof ghPrs.$inferSelect;

const pullState = z.enum(['open', 'closed', 'merged']);
const reviewState = z.enum(['approved', 'changes_requested', 'commented', 'dismissed']);
const conclusion = checkConclusionSchema.nullable();
const paths = z.array(z.string());
const findingRow = z.union([
  z
    .string()
    .min(1)
    .max(500)
    .transform((text) => ({ text, weight: null })),
  readFindingSchema,
]);
const findings = z.array(findingRow).max(50);
const closesRow = z.array(closingRefSchema).max(100);
const headCommitsRow = z
  .array(
    z.strictObject({
      sha: z.string().min(1),
      merge: z.boolean(),
      skipCi: z.boolean(),
      closes: z.array(closingRefSchema).max(100),
    }),
  )
  .max(100);
const patchIdsRow = z.record(z.string(), z.string());
const attempted = z.object({ attemptedAt: z.iso.datetime({ offset: true }).nullable() });

export type SweepState = { readonly sweptThrough: Date | null; readonly attemptedAt: Date | null };

export async function pullRequestChanges(
  db: Executor,
  where: SQL,
): Promise<readonly PullRequestChange[]> {
  const rows = await db
    .select({ pull: ghPrs, repo: ghRepos.fullName })
    .from(ghPrs)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghPrs.repoId))
    .where(where)
    .orderBy(asc(ghPrs.githubId));
  return rows.map(({ pull, repo }) => ({
    repo,
    githubId: pull.githubId,
    number: pull.number,
    head: pull.headSha,
    baseSha: pull.baseSha,
    title: pull.title,
    open: pull.state === 'open',
    requestedReviewers: [...pull.requestedReviewers],
    filesKnown: comparisonOf(pull) !== null,
  }));
}

export function openPullRequests(
  db: Executor,
  repoId: number,
): Promise<readonly PullRequestChange[]> {
  return pullRequestChanges(
    db,
    and(eq(ghPrs.repoId, repoId), eq(ghPrs.state, 'open')) ?? sql`false`,
  );
}

export async function repoByName(
  db: Executor,
  fullName: string,
): Promise<{ readonly githubId: number; readonly sweptThrough: Date | null } | null> {
  const [row] = await db
    .select({ githubId: ghRepos.githubId, sweptThrough: ghRepos.sweptThrough })
    .from(ghRepos)
    .where(sql`lower(${ghRepos.fullName}) = lower(${fullName})`)
    .limit(1);
  return row ?? null;
}

export async function defaultBranchOf(db: Executor, fullName: string): Promise<string | null> {
  const [row] = await db
    .select({ defaultBranch: ghRepos.defaultBranch })
    .from(ghRepos)
    .where(sql`lower(${ghRepos.fullName}) = lower(${fullName})`)
    .limit(1);
  return row?.defaultBranch ?? null;
}

export async function openPullRequestFrom(
  db: Executor,
  fullName: string,
  branch: string,
): Promise<{ readonly number: number; readonly head: string } | null> {
  const [row] = await db
    .select({ number: ghPrs.number, head: ghPrs.headSha })
    .from(ghPrs)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghPrs.repoId))
    .where(
      and(
        sql`lower(${ghRepos.fullName}) = lower(${fullName})`,
        eq(ghPrs.headRef, branch),
        eq(ghPrs.state, 'open'),
      ),
    )
    .orderBy(desc(ghPrs.number))
    .limit(1);
  return row ?? null;
}

async function checksAt(db: Executor, pull: PullRow): Promise<readonly CheckFact[]> {
  const rows = await db
    .select()
    .from(ghCheckRuns)
    .where(and(eq(ghCheckRuns.repoId, pull.repoId), eq(ghCheckRuns.headSha, pull.headSha)))
    .orderBy(asc(ghCheckRuns.githubId));
  return rows.flatMap((row) => {
    const parsed = conclusion.safeParse(row.conclusion);
    if (!parsed.success) return [];
    return [
      {
        checkId: row.githubId,
        name: row.name,
        headSha: row.headSha,
        app: row.appSlug,
        conclusion: parsed.data,
      },
    ];
  });
}

async function reviewsOf(db: Executor, pull: PullRow): Promise<readonly ReviewFact[]> {
  const rows = await db
    .select()
    .from(ghReviews)
    .where(eq(ghReviews.prId, pull.githubId))
    .orderBy(asc(ghReviews.githubId));
  return rows.flatMap((row) => {
    const state = reviewState.safeParse(row.state);
    if (!state.success) return [];
    return [
      {
        reviewId: row.githubId,
        reviewer: row.reviewerLogin,
        commit: row.commitId,
        state: state.data,
        provider: row.provider,
        findings: findings.safeParse(row.findings).data ?? [],
        submittedAt: row.submittedAt,
      },
    ];
  });
}

function filesOf(pull: PullRow): ChangedFiles | null {
  if (pull.filesHead !== pull.headSha || pull.filesBase !== pull.baseSha) return null;
  const parsed = paths.safeParse(pull.files);
  return parsed.success ? { head: pull.headSha, base: pull.baseSha, paths: parsed.data } : null;
}

function comparisonOf(pull: PullRow): BaseComparison | null {
  if (pull.filesHead !== pull.headSha || pull.filesBase !== pull.baseSha) return null;
  if (pull.behindBy === null && pull.patchId === null && pull.headCommits === null) return null;
  const commits = pull.headCommits === null ? null : headCommitsRow.safeParse(pull.headCommits);
  return {
    head: pull.headSha,
    base: pull.baseSha,
    behindBy: pull.behindBy,
    patchId: pull.patchId,
    commits: commits === null || !commits.success ? null : commits.data,
    patchIds: patchIdsRow.safeParse(pull.patchIds).data ?? {},
  };
}

async function pullNamed(db: Executor, ref: PullRequestRef) {
  const [row] = await db
    .select({ pull: ghPrs, repo: ghRepos.fullName, defaultBranch: ghRepos.defaultBranch })
    .from(ghPrs)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghPrs.repoId))
    .where(and(sql`lower(${ghRepos.fullName}) = lower(${ref.repo})`, eq(ghPrs.number, ref.number)))
    .limit(1);
  return row ?? null;
}

export async function pullRequestFacts(
  db: Executor,
  ref: PullRequestRef,
): Promise<PullRequestFacts | null> {
  const found = await pullNamed(db, ref);
  const state = pullState.safeParse(found?.pull.state);
  if (found === null || !state.success) return null;
  const { pull, repo, defaultBranch } = found;
  const declaration = pullRequestDeclarationSchema.safeParse(pull.declaration);
  return {
    ref: { repo, number: pull.number },
    state: state.data,
    draft: pull.draft,
    head: pull.headSha,
    headRef: pull.headRef,
    headRepo: pull.headRepo,
    base: pull.baseSha,
    baseRef: pull.baseRef,
    defaultBranch,
    checks: await checksAt(db, pull),
    reviews: await reviewsOf(db, pull),
    files: filesOf(pull),
    declaration: declaration.success ? declaration.data : null,
    closes: closesRow.safeParse(pull.closes).data ?? null,
    comparison: comparisonOf(pull),
    freshAt: pull.freshAt,
  };
}

export async function sweepStates(
  db: Executor,
  repoIds: readonly number[],
): Promise<ReadonlyMap<number, SweepState>> {
  if (repoIds.length === 0) return new Map();
  const rows = await db
    .select({
      githubId: ghRepos.githubId,
      sweptThrough: ghRepos.sweptThrough,
      lastSweep: ghRepos.lastSweep,
    })
    .from(ghRepos)
    .where(inArray(ghRepos.githubId, [...repoIds]));
  return new Map(
    rows.map((row) => {
      const parsed = attempted.safeParse(row.lastSweep);
      const at = parsed.success ? parsed.data.attemptedAt : null;
      return [
        row.githubId,
        { sweptThrough: row.sweptThrough, attemptedAt: at ? new Date(at) : null },
      ];
    }),
  );
}

export async function issueByNumber(
  db: Executor,
  repository: string,
  number: number,
): Promise<IssueChange | null> {
  const [row] = await db
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(and(sql`lower(${ghRepos.fullName}) = lower(${repository})`, eq(ghIssues.number, number)))
    .limit(1);
  if (row === undefined) return null;
  return issueChangeOf(row.issue, row.repo, null);
}

export async function issuesAwaitingCrossReference(
  db: Executor,
  repoId: number,
): Promise<readonly IssueChange[]> {
  const rows = await db
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(
      and(
        eq(ghIssues.repoId, repoId),
        isNull(ghIssues.xrefCommentId),
        eq(ghIssues.state, 'open'),
        sql`EXISTS (SELECT 1 FROM unnest(${ghIssues.labels}) AS label WHERE lower(label) = ${HARNESS_LABEL})`,
      ),
    )
    .orderBy(asc(ghIssues.githubId));
  return rows.map(({ issue, repo }) => issueChangeOf(issue, repo, null));
}

const lastSweep = z.object({
  at: z.iso.datetime({ offset: true }),
  outcome: z.string(),
  reason: z.string().nullable(),
});

export type SweepHealth = {
  readonly fullName: string;
  readonly sweptThrough: Date | null;
  readonly lastSweep: z.infer<typeof lastSweep> | null;
};

export async function sweepHealth(db: Executor): Promise<readonly SweepHealth[]> {
  const rows = await db
    .select({
      fullName: ghRepos.fullName,
      sweptThrough: ghRepos.sweptThrough,
      lastSweep: ghRepos.lastSweep,
    })
    .from(ghRepos)
    .orderBy(asc(ghRepos.fullName));
  return rows.map((row) => {
    const parsed = lastSweep.safeParse(row.lastSweep);
    return { ...row, lastSweep: parsed.success ? parsed.data : null };
  });
}
