import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { checkConclusionSchema, pullRequestDeclarationSchema } from '@uw/contracts';
import type { Executor } from '@uw/db/client';
import { ghCheckRuns, ghPrs, ghRepos, ghReviews } from '@uw/db/schema';
import type {
  ChangedFiles,
  CheckFact,
  PullRequestFacts,
  PullRequestRef,
  ReviewFact,
} from '@uw/harness';

export type PullRequestChange = {
  readonly repo: string;
  readonly githubId: number;
  readonly number: number;
  readonly head: string;
  readonly baseSha: string;
  readonly filesKnown: boolean;
};

type PullRow = typeof ghPrs.$inferSelect;

const pullState = z.enum(['open', 'closed', 'merged']);
const reviewState = z.enum(['approved', 'changes_requested', 'commented', 'dismissed']);
const conclusion = checkConclusionSchema.nullable();
const paths = z.array(z.string());

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
    filesKnown: pull.filesHead === pull.headSha && pull.filesBase === pull.baseSha,
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

async function pullNamed(db: Executor, ref: PullRequestRef) {
  const [row] = await db
    .select({ pull: ghPrs, repo: ghRepos.fullName })
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
  const { pull, repo } = found;
  const declaration = pullRequestDeclarationSchema.safeParse(pull.declaration);
  return {
    ref: { repo, number: pull.number },
    state: state.data,
    draft: pull.draft,
    head: pull.headSha,
    headRef: pull.headRef,
    base: pull.baseSha,
    checks: await checksAt(db, pull),
    reviews: await reviewsOf(db, pull),
    files: filesOf(pull),
    declaration: declaration.success ? declaration.data : null,
    freshAt: pull.freshAt,
  };
}
