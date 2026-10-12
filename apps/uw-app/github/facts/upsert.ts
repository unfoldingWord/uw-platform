import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { advisoryLock, githubRepoKey } from '@uw/db/advisory-locks';
import type { Database, Executor, Transaction } from '@uw/db/client';
import { ghCheckRuns, ghIssues, ghMilestones, ghPrs, ghRepos, ghReviews } from '@uw/db/schema';
import type {
  CheckRunRecord,
  FactBatch,
  FilesRecord,
  IssueChange,
  IssueRecord,
  MilestoneRecord,
  PullRequestRecord,
  RepoRecord,
  ReviewRecord,
} from './records.ts';
import { pullRequestChanges, type PullRequestChange } from './queries.ts';

export type RepairCounts = {
  readonly repos: number;
  readonly milestones: number;
  readonly issues: number;
  readonly pullRequests: number;
  readonly checkRuns: number;
  readonly reviews: number;
  readonly files: number;
};

export type UpsertReport = {
  readonly repaired: RepairCounts;
  readonly issues: readonly IssueChange[];
  readonly pullRequests: readonly PullRequestChange[];
};

type Columns = Readonly<Record<string, PgColumn>>;
type Keyed = { readonly githubId: number };
type Dated = Keyed & { readonly githubUpdatedAt: Date };

function updatedAt(record: Keyed): number | null {
  return 'githubUpdatedAt' in record && record.githubUpdatedAt instanceof Date
    ? record.githubUpdatedAt.getTime()
    : null;
}

function supersedes(record: Keyed, held: Keyed | undefined): boolean {
  if (held === undefined) return true;
  const [incoming, stored] = [updatedAt(record), updatedAt(held)];
  return incoming === null || stored === null || incoming >= stored;
}

function inIdOrder<T extends Keyed>(records: readonly T[]): T[] {
  const latest = new Map<number, T>();
  for (const record of records) {
    if (supersedes(record, latest.get(record.githubId))) latest.set(record.githubId, record);
  }
  return [...latest.values()].sort((a, b) => a.githubId - b.githubId);
}

function excluded(columns: Columns): Record<string, SQL> {
  return Object.fromEntries(
    Object.entries(columns).map(([key, column]) => [key, sql.raw(`excluded.${column.name}`)]),
  );
}

function differs(table: string, columns: Columns): SQL {
  const names = Object.values(columns).map((column) => column.name);
  const stored = names.map((name) => `${table}.${name}`).join(', ');
  const incoming = names.map((name) => `excluded.${name}`).join(', ');
  return sql.raw(`(${stored}) IS DISTINCT FROM (${incoming})`);
}

function both(left: SQL, right: SQL): SQL {
  return sql`${left} AND ${right}`;
}

function notOlder(table: string): SQL {
  return sql.raw(`excluded.github_updated_at >= ${table}.github_updated_at`);
}

const pullMovesForward = [
  'excluded.github_updated_at > gh_prs.github_updated_at',
  'OR (excluded.github_updated_at = gh_prs.github_updated_at AND excluded.head_sha = gh_prs.head_sha)',
].join(' ');

const statusRank = (side: string) =>
  `CASE ${side}.status WHEN 'completed' THEN 2 WHEN 'in_progress' THEN 1 ELSE 0 END`;
const completedAt = (side: string) => `COALESCE(${side}.completed_at, '-infinity'::timestamptz)`;
const checkMovesForward = [
  `${statusRank('excluded')} > ${statusRank('gh_check_runs')}`,
  `OR (${statusRank('excluded')} = ${statusRank('gh_check_runs')}`,
  `AND (excluded.status <> 'completed' OR ${completedAt('excluded')} >= ${completedAt('gh_check_runs')}))`,
].join(' ');

function pullsTouched(batch: FactBatch): readonly number[] {
  const ids = new Set<number>([
    ...batch.pullRequests.map((pull) => pull.githubId),
    ...batch.reviews.map((review) => review.pullRequestId),
    ...batch.files.map((files) => files.pullRequestId),
  ]);
  return [...ids].sort((a, b) => a - b);
}

const repoColumns = {
  fullName: ghRepos.fullName,
  defaultBranch: ghRepos.defaultBranch,
  private: ghRepos.private,
};
const milestoneColumns = {
  repoId: ghMilestones.repoId,
  number: ghMilestones.number,
  title: ghMilestones.title,
  state: ghMilestones.state,
  dueOn: ghMilestones.dueOn,
  githubUpdatedAt: ghMilestones.githubUpdatedAt,
};
const issueColumns = {
  repoId: ghIssues.repoId,
  number: ghIssues.number,
  title: ghIssues.title,
  state: ghIssues.state,
  labels: ghIssues.labels,
  milestoneId: ghIssues.milestoneId,
  githubUpdatedAt: ghIssues.githubUpdatedAt,
};
const pullColumns = {
  repoId: ghPrs.repoId,
  number: ghPrs.number,
  title: ghPrs.title,
  state: ghPrs.state,
  draft: ghPrs.draft,
  headSha: ghPrs.headSha,
  headRef: ghPrs.headRef,
  headRepo: ghPrs.headRepo,
  baseRef: ghPrs.baseRef,
  baseSha: ghPrs.baseSha,
  milestoneId: ghPrs.milestoneId,
  declaration: ghPrs.declaration,
  declarationProblem: ghPrs.declarationProblem,
  githubUpdatedAt: ghPrs.githubUpdatedAt,
};
const checkColumns = {
  repoId: ghCheckRuns.repoId,
  headSha: ghCheckRuns.headSha,
  name: ghCheckRuns.name,
  appSlug: ghCheckRuns.appSlug,
  status: ghCheckRuns.status,
  conclusion: ghCheckRuns.conclusion,
  startedAt: ghCheckRuns.startedAt,
  completedAt: ghCheckRuns.completedAt,
};
const reviewColumns = {
  repoId: ghReviews.repoId,
  prId: ghReviews.prId,
  reviewerLogin: ghReviews.reviewerLogin,
  commitId: ghReviews.commitId,
  state: ghReviews.state,
  provider: ghReviews.provider,
  findings: ghReviews.findings,
  submittedAt: ghReviews.submittedAt,
};
const sameComparison =
  'gh_prs.head_sha = excluded.head_sha AND gh_prs.base_sha = excluded.base_sha AND gh_prs.base_ref = excluded.base_ref';
const sameHeadOr = (column: string) =>
  sql.raw(`CASE WHEN ${sameComparison} THEN gh_prs.${column} END`);

function placeholderFor(held: { readonly githubId: number; readonly fullName: string }): string {
  const [owner] = held.fullName.split('/');
  return `${owner}/moved.${held.githubId}`;
}

async function releaseNames(tx: Transaction, repos: readonly RepoRecord[]): Promise<void> {
  const claimants = new Map(repos.map((repo) => [repo.fullName.toLowerCase(), repo.githubId]));
  const holders = await tx
    .select({ githubId: ghRepos.githubId, fullName: ghRepos.fullName })
    .from(ghRepos)
    .where(
      or(
        inArray(
          ghRepos.githubId,
          repos.map((repo) => repo.githubId),
        ),
        inArray(sql`lower(${ghRepos.fullName})`, [...claimants.keys()]),
      ),
    )
    .orderBy(asc(ghRepos.githubId))
    .for('update');
  for (const held of holders) {
    const claimant = claimants.get(held.fullName.toLowerCase());
    if (claimant === undefined || claimant === held.githubId) continue;
    await tx
      .update(ghRepos)
      .set({ fullName: placeholderFor(held) })
      .where(eq(ghRepos.githubId, held.githubId));
  }
}

async function upsertRepos(tx: Transaction, repos: readonly RepoRecord[], freshAt: Date) {
  if (repos.length === 0) return 0;
  await releaseNames(tx, repos);
  const rows = await tx
    .insert(ghRepos)
    .values(repos.map((repo) => ({ ...repo, freshAt })))
    .onConflictDoUpdate({
      target: ghRepos.githubId,
      set: excluded(repoColumns),
      setWhere: differs('gh_repos', repoColumns),
    })
    .returning({ githubId: ghRepos.githubId });
  return rows.length;
}

async function upsertMilestones(
  tx: Transaction,
  milestones: readonly MilestoneRecord[],
  freshAt: Date,
) {
  if (milestones.length === 0) return 0;
  const rows = await tx
    .insert(ghMilestones)
    .values(milestones.map((milestone) => ({ ...milestone, freshAt })))
    .onConflictDoUpdate({
      target: ghMilestones.githubId,
      set: excluded(milestoneColumns),
      setWhere: both(notOlder('gh_milestones'), differs('gh_milestones', milestoneColumns)),
    })
    .returning({ githubId: ghMilestones.githubId });
  return rows.length;
}

async function upsertIssues(tx: Transaction, issues: readonly IssueRecord[], freshAt: Date) {
  if (issues.length === 0) return 0;
  const rows = await tx
    .insert(ghIssues)
    .values(issues.map((issue) => ({ ...issue, labels: [...issue.labels], freshAt })))
    .onConflictDoUpdate({
      target: ghIssues.githubId,
      set: excluded(issueColumns),
      setWhere: both(notOlder('gh_issues'), differs('gh_issues', issueColumns)),
    })
    .returning({ githubId: ghIssues.githubId });
  return rows.length;
}

async function upsertPulls(tx: Transaction, pulls: readonly PullRequestRecord[], freshAt: Date) {
  if (pulls.length === 0) return 0;
  const rows = await tx
    .insert(ghPrs)
    .values(pulls.map((pull) => ({ ...pull, freshAt })))
    .onConflictDoUpdate({
      target: ghPrs.githubId,
      set: {
        ...excluded(pullColumns),
        files: sameHeadOr('files'),
        filesHead: sameHeadOr('files_head'),
        filesBase: sameHeadOr('files_base'),
        filesProblem: sameHeadOr('files_problem'),
      },
      setWhere: both(sql.raw(`(${pullMovesForward})`), differs('gh_prs', pullColumns)),
    })
    .returning({ githubId: ghPrs.githubId });
  return rows.length;
}

async function upsertChecks(tx: Transaction, runs: readonly CheckRunRecord[], freshAt: Date) {
  if (runs.length === 0) return 0;
  const rows = await tx
    .insert(ghCheckRuns)
    .values(runs.map((run) => ({ ...run, freshAt })))
    .onConflictDoUpdate({
      target: ghCheckRuns.githubId,
      set: excluded(checkColumns),
      setWhere: both(sql.raw(checkMovesForward), differs('gh_check_runs', checkColumns)),
    })
    .returning({ githubId: ghCheckRuns.githubId });
  return rows.length;
}

async function upsertReviews(tx: Transaction, reviews: readonly ReviewRecord[], freshAt: Date) {
  if (reviews.length === 0) return 0;
  const rows = await tx
    .insert(ghReviews)
    .values(
      reviews.map(({ pullRequestId, ...review }) => ({ ...review, prId: pullRequestId, freshAt })),
    )
    .onConflictDoUpdate({
      target: ghReviews.githubId,
      set: excluded(reviewColumns),
      setWhere: both(
        sql.raw(`gh_reviews.state <> 'dismissed'`),
        differs('gh_reviews', reviewColumns),
      ),
    })
    .returning({ githubId: ghReviews.githubId });
  return rows.length;
}

async function stampDated(
  tx: Transaction,
  table: string,
  records: readonly Dated[],
  freshAt: Date,
) {
  if (records.length === 0) return;
  const values = sql.join(
    records.map(
      (record) =>
        sql`(${record.githubId}::bigint, ${record.githubUpdatedAt.toISOString()}::timestamptz)`,
    ),
    sql`, `,
  );
  await tx.execute(
    sql`UPDATE ${sql.identifier(table)} AS t SET fresh_at = ${freshAt.toISOString()}::timestamptz FROM (VALUES ${values}) AS v(id, updated) WHERE t.github_id = v.id AND t.github_updated_at <= v.updated`,
  );
}

async function stampAll(tx: Transaction, table: string, records: readonly Keyed[], freshAt: Date) {
  if (records.length === 0) return;
  const ids = sql.join(
    records.map((record) => sql`${record.githubId}::bigint`),
    sql`, `,
  );
  await tx.execute(
    sql`UPDATE ${sql.identifier(table)} SET fresh_at = ${freshAt.toISOString()}::timestamptz WHERE github_id IN (${ids})`,
  );
}

function reposNamed(batch: FactBatch): readonly number[] {
  const ids = new Set<number>([
    ...batch.repos.map((repo) => repo.githubId),
    ...[
      ...batch.milestones,
      ...batch.issues,
      ...batch.pullRequests,
      ...batch.checkRuns,
      ...batch.reviews,
    ].map((record) => record.repoId),
  ]);
  return [...ids].sort((a, b) => a - b);
}

async function lockRepos(tx: Transaction, ids: readonly number[]) {
  for (const id of ids) await tx.execute(advisoryLock(githubRepoKey(id)));
}

async function lockedLabels(tx: Transaction, ids: readonly number[]) {
  if (ids.length === 0) return new Map<number, readonly string[]>();
  const rows = await tx
    .select({ githubId: ghIssues.githubId, labels: ghIssues.labels })
    .from(ghIssues)
    .where(inArray(ghIssues.githubId, [...ids]))
    .orderBy(asc(ghIssues.githubId))
    .for('update');
  return new Map(rows.map((row) => [row.githubId, row.labels]));
}

async function lockPulls(tx: Transaction, ids: readonly number[]) {
  if (ids.length === 0) return;
  await tx
    .select({ githubId: ghPrs.githubId })
    .from(ghPrs)
    .where(inArray(ghPrs.githubId, [...ids]))
    .orderBy(asc(ghPrs.githubId))
    .for('update');
}

async function storedIssues(
  tx: Transaction,
  ids: readonly number[],
  had: ReadonlyMap<number, readonly string[]>,
) {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ issue: ghIssues, repo: ghRepos.fullName })
    .from(ghIssues)
    .innerJoin(ghRepos, eq(ghRepos.githubId, ghIssues.repoId))
    .where(inArray(ghIssues.githubId, [...ids]))
    .orderBy(asc(ghIssues.githubId));
  return rows.map(({ issue, repo }): IssueChange => ({
    repo,
    githubId: issue.githubId,
    number: issue.number,
    title: issue.title,
    open: issue.state === 'open',
    labels: issue.labels,
    hadLabels: had.get(issue.githubId) ?? null,
    githubUpdatedAt: issue.githubUpdatedAt,
  }));
}

async function recordFilesIn(db: Executor, files: FilesRecord): Promise<boolean> {
  const at = and(
    eq(ghPrs.githubId, files.pullRequestId),
    eq(ghPrs.headSha, files.head),
    eq(ghPrs.baseSha, files.base),
  );
  const rows = await db
    .update(ghPrs)
    .set({
      files: files.paths,
      filesHead: files.head,
      filesBase: files.base,
      filesProblem: files.problem,
    })
    .where(at)
    .returning({ githubId: ghPrs.githubId });
  return rows.length > 0;
}

async function recordAllFiles(tx: Transaction, files: readonly FilesRecord[]) {
  let landed = 0;
  const ordered = [...files].sort((a, b) => a.pullRequestId - b.pullRequestId);
  for (const record of ordered) if (await recordFilesIn(tx, record)) landed += 1;
  return landed;
}

async function writeRecords(
  tx: Transaction,
  batch: FactBatch,
  freshAt: Date,
): Promise<RepairCounts> {
  const repos = await upsertRepos(tx, inIdOrder(batch.repos), freshAt);
  const milestones = await upsertMilestones(tx, inIdOrder(batch.milestones), freshAt);
  const issues = await upsertIssues(tx, inIdOrder(batch.issues), freshAt);
  const pullRequests = await upsertPulls(tx, inIdOrder(batch.pullRequests), freshAt);
  const checkRuns = await upsertChecks(tx, inIdOrder(batch.checkRuns), freshAt);
  const reviews = await upsertReviews(tx, inIdOrder(batch.reviews), freshAt);
  const files = await recordAllFiles(tx, batch.files);
  return { repos, milestones, issues, pullRequests, checkRuns, reviews, files };
}

async function stampFresh(tx: Transaction, batch: FactBatch, freshAt: Date): Promise<void> {
  await stampAll(tx, 'gh_repos', inIdOrder(batch.repos), freshAt);
  await stampDated(tx, 'gh_milestones', inIdOrder(batch.milestones), freshAt);
  await stampDated(tx, 'gh_issues', inIdOrder(batch.issues), freshAt);
  await stampDated(tx, 'gh_prs', inIdOrder(batch.pullRequests), freshAt);
  await stampAll(tx, 'gh_check_runs', inIdOrder(batch.checkRuns), freshAt);
  await stampAll(tx, 'gh_reviews', inIdOrder(batch.reviews), freshAt);
}

export function upsertFacts(db: Database, batch: FactBatch, freshAt: Date): Promise<UpsertReport> {
  const issueIds = inIdOrder(batch.issues).map((issue) => issue.githubId);
  const pullIds = inIdOrder(batch.pullRequests).map((pull) => pull.githubId);
  return db.transaction(async (tx) => {
    await lockRepos(tx, reposNamed(batch));
    const had = await lockedLabels(tx, issueIds);
    await lockPulls(tx, pullsTouched(batch));
    const repaired = await writeRecords(tx, batch, freshAt);
    await stampFresh(tx, batch, freshAt);
    const issues = await storedIssues(tx, issueIds, had);
    const pullRequests =
      pullIds.length === 0 ? [] : await pullRequestChanges(tx, inArray(ghPrs.githubId, pullIds));
    return { repaired, issues, pullRequests };
  });
}

export function recordFiles(db: Database, files: FilesRecord): Promise<boolean> {
  return recordFilesIn(db, files);
}

export type SweepRecord = {
  readonly at: Date;
  readonly attemptedAt: Date | null;
  readonly outcome: 'ok' | 'capped' | 'stalled' | 'deferred' | 'failed';
  readonly heldAt: Date | null;
  readonly reason: string | null;
  readonly repaired: RepairCounts;
  readonly unparsedItems: number;
};

function sweepJson(record: SweepRecord) {
  return {
    ...record,
    at: record.at.toISOString(),
    attemptedAt: record.attemptedAt?.toISOString() ?? null,
    heldAt: record.heldAt?.toISOString() ?? null,
  };
}

export async function recordSweep(
  db: Database,
  repoId: number,
  sweptThrough: Date | null,
  record: SweepRecord,
): Promise<void> {
  const through = sweptThrough?.toISOString();
  const forward =
    through === undefined
      ? {}
      : {
          sweptThrough: sql`GREATEST(COALESCE(${ghRepos.sweptThrough}, ${through}::timestamptz), ${through}::timestamptz)`,
        };
  await db
    .update(ghRepos)
    .set({ ...forward, lastSweep: sweepJson(record) })
    .where(eq(ghRepos.githubId, repoId));
}
