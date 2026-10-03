import { errorFields, type Logger } from '@uw/core/log';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads, LIST_PAGES, type GitHubReads } from './client.ts';
import { createIssueComments, type IssueComments } from './comments.ts';
import type { GitHubDeps } from './deps.ts';
import { failed, type GitHubFailure, type GitHubResult } from './failures.ts';
import { fetchFilesAtHead } from './facts/files.ts';
import {
  checkRunsFromRest,
  factsFromPull,
  issuesFromRest,
  repoFromRest,
  reviewsFromRest,
} from './facts/normalise.ts';
import {
  issuesAwaitingCrossReference,
  openPullRequests,
  sweepStates,
  type SweepState,
} from './facts/queries.ts';
import { emptyBatch, type FactBatch, type RepoRecord } from './facts/records.ts';
import { recordSweep, upsertFacts, type RepairCounts, type SweepRecord } from './facts/upsert.ts';
import { followUpserts } from './follow-up.ts';
import { followIssue } from './import.ts';
import { issueSchema } from './payloads.ts';
import type { GitHubTransport } from './transport.ts';

type SweepDeps = Omit<GitHubDeps, 'client'> & {
  readonly app: GitHubAppConfig;
  readonly transport: GitHubTransport;
};

export type SweepOptions = {
  readonly maxPages?: number;
  readonly maxSubrequests?: number;
  readonly wakesOwed?: () => number;
};

type Outcome = SweepRecord['outcome'];
type Reason = GitHubFailure | 'budget_exhausted' | 'page_limit' | 'pull_request_not_swept';

type RepositorySweep = {
  readonly repo: string;
  readonly outcome: Outcome;
  readonly reason: Reason | 'internal_error' | null;
  readonly heldAt: Date | null;
  readonly candidate: Date | null;
  readonly sweptThrough: Date | null;
  readonly repaired: RepairCounts;
  readonly unparsedItems: number;
};

export type SweepReport = {
  readonly repositories: readonly RepositorySweep[];
  readonly failure: GitHubFailure | null;
  readonly subrequests: number;
};

type Budget = {
  spent: number;
  exhausted: boolean;
  readonly limit: number;
  readonly reserved: () => number;
};

type Run = {
  readonly deps: SweepDeps;
  readonly logger: Logger;
  readonly budget: Budget;
  readonly transport: GitHubTransport;
  readonly startedAt: Date;
  readonly maxPages: number;
};

type Pass = {
  readonly run: Run;
  readonly repo: RepoRecord;
  readonly state: SweepState;
  readonly reads: GitHubReads;
  readonly comments: IssueComments;
  readonly swept: Set<number>;
  readonly followed: Set<number>;
  repaired: RepairCounts;
  unparsed: number;
  capped: boolean;
  reason: Reason | null;
  heldAt: Date | null;
  through: Date | null;
};

const overlapMs = 10 * 60_000;
const defaultPages = 30;
const defaultSubrequests = 900;
const perPullRequest = 8;
const perCrossReference = LIST_PAGES + 2;
const repositoryStart = 2;
const wakesPerRepository = 1;
const noRepairs: RepairCounts = {
  repos: 0,
  milestones: 0,
  issues: 0,
  pullRequests: 0,
  checkRuns: 0,
  reviews: 0,
  files: 0,
};
const unswept: SweepState = { sweptThrough: null, attemptedAt: null };
const listedSchema = issueSchema.pick({ number: true, updated_at: true, pull_request: true });

function remaining(budget: Budget): number {
  return budget.limit - budget.spent - budget.reserved();
}

function reservedFor(wakesOwed: (() => number) | undefined): () => number {
  if (wakesOwed === undefined) return () => 0;
  return () => wakesOwed() + wakesPerRepository;
}

function metered(transport: GitHubTransport, budget: Budget): GitHubTransport {
  return {
    now: transport.now,
    fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (remaining(budget) <= 0) {
        budget.exhausted = true;
        return Promise.reject(new Error('subrequest bound reached'));
      }
      budget.spent += 1;
      return transport.fetch(input, init);
    },
  };
}

function plus(a: RepairCounts, b: RepairCounts): RepairCounts {
  return {
    repos: a.repos + b.repos,
    milestones: a.milestones + b.milestones,
    issues: a.issues + b.issues,
    pullRequests: a.pullRequests + b.pullRequests,
    checkRuns: a.checkRuns + b.checkRuns,
    reviews: a.reviews + b.reviews,
    files: a.files + b.files,
  };
}

function earlier(a: Date | null, b: Date): Date {
  return a === null || b < a ? b : a;
}

function later(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  return b !== null && b > a ? b : a;
}

function stop(pass: Pass, reason: Reason): void {
  pass.reason ??= reason;
  if (reason === 'budget_exhausted' || reason === 'page_limit') pass.capped = true;
}

function affordable(pass: Pass): boolean {
  if (remaining(pass.run.budget) >= perPullRequest) return true;
  stop(pass, 'budget_exhausted');
  return false;
}

function githubDeps(pass: Pass): GitHubDeps {
  const { db, kernel, now } = pass.run.deps;
  const client = {
    appId: pass.run.deps.app.appId,
    reads: () => pass.reads,
    comments: () => pass.comments,
  };
  return { db, kernel, now, client };
}

async function upsertAndFollow(pass: Pass, batch: FactBatch): Promise<void> {
  const report = await upsertFacts(pass.run.deps.db, batch, pass.run.deps.now());
  pass.repaired = plus(pass.repaired, report.repaired);
  for (const issue of report.issues) pass.followed.add(issue.githubId);
  await followUpserts(githubDeps(pass), report, pass.run.logger);
}

async function followAwaiting(pass: Pass): Promise<void> {
  const awaiting = await issuesAwaitingCrossReference(pass.run.deps.db, pass.repo.githubId);
  for (const change of awaiting) {
    if (pass.followed.has(change.githubId)) continue;
    if (remaining(pass.run.budget) < perCrossReference) return;
    await followIssue(githubDeps(pass), change, pass.run.logger);
  }
}

async function storePull(pass: Pass, batch: FactBatch): Promise<GitHubResult<true>> {
  const { db, now } = pass.run.deps;
  const report = await upsertFacts(db, batch, now());
  pass.repaired = plus(pass.repaired, report.repaired);
  for (const change of report.pullRequests) {
    if (change.filesKnown) continue;
    const fetched = await fetchFilesAtHead(pass.reads, db, change);
    if (!fetched.ok) return fetched;
    if (!fetched.value) return failed('conflict', null);
    pass.repaired = plus(pass.repaired, { ...noRepairs, files: 1 });
  }
  const handled = report.pullRequests.map((change) => ({ ...change, filesKnown: true }));
  await followUpserts(githubDeps(pass), { ...report, pullRequests: handled }, pass.run.logger);
  return { ok: true, value: true };
}

async function readPull(pass: Pass, number: number): Promise<GitHubResult<true>> {
  const { reads, repo } = pass;
  const answer = await reads.pullRequest(repo.fullName, number);
  if (!answer.ok) return answer;
  const batch = factsFromPull(repo, answer.value);
  const pull = batch?.pullRequests[0];
  if (!batch || pull?.number !== number) return failed('malformed_response', null);
  const reviews = await reads.pullRequestReviews(repo.fullName, number);
  if (!reviews.ok) return reviews;
  const runs = await reads.checkRuns(repo.fullName, pull.headSha);
  if (!runs.ok) return runs;
  return storePull(pass, {
    ...batch,
    reviews: reviewsFromRest(repo, pull.githubId, reviews.value),
    checkRuns: checkRunsFromRest(repo.githubId, runs.value),
  });
}

async function sweepPull(pass: Pass, number: number): Promise<boolean> {
  const read = await readPull(pass, number);
  if (read.ok) {
    pass.swept.add(number);
    return true;
  }
  const failure = pass.run.budget.exhausted ? 'budget_exhausted' : read.failure;
  stop(pass, failure === 'budget_exhausted' ? failure : 'pull_request_not_swept');
  pass.run.logger.warn('pull request not swept', {
    outcome: 'pull_request_not_swept',
    repository: pass.repo.fullName,
    pull_request: number,
    failure,
    status: read.status,
  });
  return false;
}

function listedOf(pass: Pass, issues: readonly unknown[]) {
  return issues.flatMap((issue) => {
    const parsed = listedSchema.safeParse(issue);
    if (parsed.success) return [parsed.data];
    pass.unparsed += 1;
    return [];
  });
}

async function sweepListing(pass: Pass, issues: readonly unknown[]): Promise<void> {
  const listed = listedOf(pass, issues);
  const { issues: records, milestones } = issuesFromRest(pass.repo, issues);
  const pulls = listed.filter((issue) => issue.pull_request);
  pass.unparsed += listed.length - pulls.length - records.length;
  await upsertAndFollow(pass, { ...emptyBatch, repos: [pass.repo], milestones, issues: records });
  for (const issue of listed) {
    if (pass.through === null || issue.updated_at > pass.through) pass.through = issue.updated_at;
  }
  for (const pull of pulls) {
    const swept = affordable(pass) && (await sweepPull(pass, pull.number));
    if (!swept) pass.heldAt = earlier(pass.heldAt, pull.updated_at);
  }
}

async function sweepOpen(pass: Pass): Promise<void> {
  const open = await openPullRequests(pass.run.deps.db, pass.repo.githubId);
  for (const pull of open) {
    if (pass.swept.has(pull.number)) continue;
    if (!affordable(pass)) return;
    await sweepPull(pass, pull.number);
  }
}

async function listIssues(pass: Pass) {
  const watermark = pass.state.sweptThrough;
  const since = watermark ? new Date(watermark.getTime() - overlapMs) : null;
  const affordablePages = remaining(pass.run.budget) - 1 - perPullRequest;
  const pages = Math.max(1, Math.min(pass.run.maxPages, affordablePages));
  const listing = await pass.reads.issuesSince(pass.repo.fullName, since, pages);
  if (listing.ok && listing.value.capped) {
    stop(pass, pages < pass.run.maxPages ? 'budget_exhausted' : 'page_limit');
  }
  return listing;
}

function outcomeOf(pass: Pass, sweptThrough: Date | null): Outcome {
  const stored = pass.state.sweptThrough;
  if (sweptThrough !== null && stored !== null && sweptThrough < stored) return 'stalled';
  return pass.capped ? 'capped' : 'ok';
}

function sweepOf(
  pass: Pass,
  outcome: Outcome,
  candidate: Date | null,
  reason: RepositorySweep['reason'],
): RepositorySweep {
  const { repo, repaired, heldAt, unparsed } = pass;
  return {
    repo: repo.fullName,
    outcome,
    reason,
    heldAt,
    candidate,
    sweptThrough: later(pass.state.sweptThrough, candidate),
    repaired,
    unparsedItems: unparsed,
  };
}

async function recorded(pass: Pass, sweep: RepositorySweep): Promise<RepositorySweep> {
  const { deps, startedAt } = pass.run;
  const attemptedAt = sweep.outcome === 'deferred' ? pass.state.attemptedAt : startedAt;
  await recordSweep(deps.db, pass.repo.githubId, sweep.candidate, {
    at: deps.now(),
    attemptedAt,
    outcome: sweep.outcome,
    heldAt: sweep.heldAt,
    reason: sweep.reason,
    repaired: sweep.repaired,
    unparsedItems: sweep.unparsedItems,
  });
  return sweep;
}

async function passOver(pass: Pass): Promise<RepositorySweep> {
  await upsertAndFollow(pass, { ...emptyBatch, repos: [pass.repo] });
  const listing = await listIssues(pass);
  if (!listing.ok) {
    const reason = pass.run.budget.exhausted ? 'budget_exhausted' : listing.failure;
    return recorded(pass, sweepOf(pass, 'failed', null, reason));
  }
  pass.unparsed += listing.value.unparsed;
  await sweepListing(pass, listing.value.issues);
  await sweepOpen(pass);
  await followAwaiting(pass);
  const candidate = pass.heldAt ?? pass.through;
  return recorded(pass, sweepOf(pass, outcomeOf(pass, candidate), candidate, pass.reason));
}

function logged(logger: Logger, sweep: RepositorySweep): RepositorySweep {
  const { repaired } = sweep;
  if (sweep.outcome === 'stalled') {
    logger.warn('github sweep stalled below its watermark', {
      outcome: 'stalled',
      repository: sweep.repo,
      reason: sweep.reason,
      held_at: sweep.candidate?.toISOString() ?? null,
    });
  }
  logger[sweep.outcome === 'ok' ? 'info' : 'warn']('github sweep repaired', {
    outcome: sweep.outcome,
    repository: sweep.repo,
    reason: sweep.reason,
    held_at: sweep.heldAt?.toISOString() ?? null,
    swept_through: sweep.sweptThrough?.toISOString() ?? null,
    unparsed_items: sweep.unparsedItems,
    repaired_repos: repaired.repos,
    repaired_milestones: repaired.milestones,
    repaired_issues: repaired.issues,
    repaired_pull_requests: repaired.pullRequests,
    repaired_check_runs: repaired.checkRuns,
    repaired_reviews: repaired.reviews,
    repaired_files: repaired.files,
  });
  return sweep;
}

async function recordedFailure(pass: Pass): Promise<RepositorySweep> {
  const sweep = sweepOf(pass, 'failed', null, 'internal_error');
  const { deps, startedAt, logger } = pass.run;
  try {
    await recordSweep(deps.db, pass.repo.githubId, null, {
      at: startedAt,
      attemptedAt: startedAt,
      outcome: 'failed',
      heldAt: sweep.heldAt,
      reason: 'internal_error',
      repaired: sweep.repaired,
      unparsedItems: sweep.unparsedItems,
    });
  } catch (error) {
    logger.error('github sweep failure not recorded', {
      outcome: 'record_failed',
      repository: pass.repo.fullName,
      ...errorFields(error),
    });
  }
  return sweep;
}

async function attempt(pass: Pass): Promise<RepositorySweep> {
  if (remaining(pass.run.budget) < repositoryStart + perPullRequest) {
    await upsertAndFollow(pass, { ...emptyBatch, repos: [pass.repo] });
    return recorded(pass, sweepOf(pass, 'deferred', null, 'budget_exhausted'));
  }
  return passOver(pass);
}

async function sweepRepository(
  run: Run,
  repo: RepoRecord,
  state: SweepState,
): Promise<RepositorySweep> {
  const pass: Pass = {
    run,
    repo,
    state,
    reads: createGitHubReads(run.deps.app, run.transport),
    comments: createIssueComments(run.deps.app, run.transport),
    swept: new Set(),
    followed: new Set(),
    repaired: noRepairs,
    unparsed: 0,
    capped: false,
    reason: null,
    heldAt: null,
    through: null,
  };
  try {
    return logged(run.logger, await attempt(pass));
  } catch (error) {
    run.logger.error('github sweep failed for a repository', {
      outcome: 'internal_error',
      repository: repo.fullName,
      ...errorFields(error),
    });
    return recordedFailure(pass);
  }
}

function instant(at: Date | null): number {
  return at === null ? Number.NEGATIVE_INFINITY : at.getTime();
}

async function stalestFirst(db: SweepDeps['db'], repos: readonly RepoRecord[]) {
  const states = await sweepStates(
    db,
    repos.map((repo) => repo.githubId),
  );
  const stated = repos.map((repo) => ({ repo, state: states.get(repo.githubId) ?? unswept }));
  return stated.sort(
    (a, b) =>
      instant(a.state.attemptedAt) - instant(b.state.attemptedAt) ||
      instant(a.state.sweptThrough) - instant(b.state.sweptThrough) ||
      a.repo.githubId - b.repo.githubId,
  );
}

function runOf(deps: SweepDeps, logger: Logger, options: SweepOptions): Run {
  const budget: Budget = {
    spent: 0,
    exhausted: false,
    limit: options.maxSubrequests ?? defaultSubrequests,
    reserved: reservedFor(options.wakesOwed),
  };
  return {
    deps,
    logger,
    budget,
    transport: metered(deps.transport, budget),
    startedAt: deps.now(),
    maxPages: options.maxPages ?? defaultPages,
  };
}

export async function sweepGitHub(
  deps: SweepDeps,
  logger: Logger,
  options: SweepOptions = {},
): Promise<SweepReport> {
  const run = runOf(deps, logger, options);
  const listed = await createGitHubReads(deps.app, run.transport).installationRepositories();
  if (!listed.ok) {
    const { failure, status } = listed;
    logger.warn('github repositories not listed', {
      outcome: 'repositories_not_listed',
      failure,
      status,
    });
    return { repositories: [], failure, subrequests: run.budget.spent };
  }
  const repos = listed.value.map(repoFromRest).filter((repo) => repo !== null);
  const repositories: RepositorySweep[] = [];
  for (const { repo, state } of await stalestFirst(deps.db, repos)) {
    repositories.push(await sweepRepository(run, repo, state));
  }
  return { repositories, failure: null, subrequests: run.budget.spent };
}
