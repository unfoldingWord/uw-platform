import { errorFields, type Logger } from '@uw/core/log';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads, type GitHubReads } from './client.ts';
import { failed, type GitHubFailure, type GitHubResult } from './failures.ts';
import { fetchFilesAtHead } from './facts/files.ts';
import {
  checkRunsFromRest,
  factsFromPull,
  issuesFromRest,
  repoFromRest,
  reviewsFromRest,
} from './facts/normalise.ts';
import { openPullRequests, repoByName } from './facts/queries.ts';
import { emptyBatch, type FactBatch, type RepoRecord } from './facts/records.ts';
import { recordSweep, upsertFacts, type RepairCounts } from './facts/upsert.ts';
import { followUpserts, type GitHubDeps } from './follow-up.ts';
import { issueSchema } from './payloads.ts';
import type { GitHubTransport } from './transport.ts';

export type SweepDeps = Omit<GitHubDeps, 'client'> & {
  readonly app: GitHubAppConfig;
  readonly transport: GitHubTransport;
};

export type SweepOptions = { readonly maxPages?: number; readonly maxSubrequests?: number };

type RepositorySweep = {
  readonly repo: string;
  readonly outcome: 'swept' | 'failed' | 'deferred';
  readonly repaired: RepairCounts;
  readonly sweptThrough: Date | null;
  readonly capped: boolean;
  readonly failure: GitHubFailure | null;
};

export type SweepReport = {
  readonly repositories: readonly RepositorySweep[];
  readonly failure: GitHubFailure | null;
  readonly subrequests: number;
};

type Budget = { spent: number; readonly limit: number };

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
  readonly reads: GitHubReads;
  readonly swept: Set<number>;
  repaired: RepairCounts;
  capped: boolean;
  heldAt: Date | null;
};

const overlapMs = 10 * 60_000;
const defaultPages = 30;
const defaultSubrequests = 900;
const perPullRequest = 8;
const repositoryStart = 2;
const unlisted = new Date(0);
const noRepairs: RepairCounts = {
  repos: 0,
  milestones: 0,
  issues: 0,
  pullRequests: 0,
  checkRuns: 0,
  reviews: 0,
  files: 0,
};
const listedSchema = issueSchema.pick({ number: true, updated_at: true, pull_request: true });

function remaining(budget: Budget): number {
  return budget.limit - budget.spent;
}

function metered(transport: GitHubTransport, budget: Budget): GitHubTransport {
  return {
    now: transport.now,
    fetch: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (remaining(budget) <= 0) return Promise.reject(new Error('subrequest bound reached'));
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

function hold(pass: Pass, at: Date): void {
  if (pass.heldAt === null || at < pass.heldAt) pass.heldAt = at;
}

function affordable(pass: Pass): boolean {
  if (remaining(pass.run.budget) >= perPullRequest) return true;
  pass.capped = true;
  return false;
}

function githubDeps(pass: Pass): GitHubDeps {
  const { db, kernel, now } = pass.run.deps;
  return { db, kernel, now, client: () => pass.reads };
}

async function upsertAndFollow(pass: Pass, batch: FactBatch): Promise<void> {
  const report = await upsertFacts(pass.run.deps.db, batch, pass.run.deps.now());
  pass.repaired = plus(pass.repaired, report.repaired);
  await followUpserts(githubDeps(pass), report, pass.run.logger);
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
  pass.run.logger.warn('pull request not swept', {
    outcome: 'pull_request_not_swept',
    repository: pass.repo.fullName,
    pull_request: number,
    failure: read.failure,
    status: read.status,
  });
  return false;
}

function listedOf(issues: readonly unknown[]) {
  return issues.flatMap((issue) => {
    const parsed = listedSchema.safeParse(issue);
    return parsed.success ? [parsed.data] : [];
  });
}

async function sweepListing(pass: Pass, issues: readonly unknown[], capped: boolean) {
  const { issues: records, milestones } = issuesFromRest(pass.repo, issues);
  await upsertAndFollow(pass, { ...emptyBatch, repos: [pass.repo], milestones, issues: records });
  const listed = listedOf(issues);
  if (capped) {
    pass.capped = true;
    hold(pass, listed.at(-1)?.updated_at ?? unlisted);
  }
  for (const pull of listed.filter((issue) => issue.pull_request)) {
    const swept = affordable(pass) && (await sweepPull(pass, pull.number));
    if (!swept) hold(pass, pull.updated_at);
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
  const stored = await repoByName(pass.run.deps.db, pass.repo.fullName);
  const watermark = stored?.sweptThrough ?? null;
  const since = watermark ? new Date(watermark.getTime() - overlapMs) : null;
  const affordablePages = remaining(pass.run.budget) - 1 - perPullRequest;
  const pages = Math.max(1, Math.min(pass.run.maxPages, affordablePages));
  return pass.reads.issuesSince(pass.repo.fullName, since, pages);
}

function finished(
  pass: Pass,
  outcome: RepositorySweep['outcome'],
  sweptThrough: Date | null,
  failure: GitHubFailure | null,
): RepositorySweep {
  const { repo, repaired, capped } = pass;
  return { repo: repo.fullName, outcome, repaired, sweptThrough, capped, failure };
}

async function passOver(pass: Pass): Promise<RepositorySweep> {
  const { deps, startedAt } = pass.run;
  await upsertAndFollow(pass, { ...emptyBatch, repos: [pass.repo] });
  const listing = await listIssues(pass);
  if (!listing.ok) return finished(pass, 'failed', null, listing.failure);
  await sweepListing(pass, listing.value.issues, listing.value.capped);
  await sweepOpen(pass);
  const sweptThrough = pass.heldAt && pass.heldAt < startedAt ? pass.heldAt : startedAt;
  await recordSweep(deps.db, pass.repo.githubId, {
    sweptThrough,
    at: deps.now(),
    repaired: pass.repaired,
  });
  return finished(pass, 'swept', sweptThrough, null);
}

function logged(logger: Logger, sweep: RepositorySweep): RepositorySweep {
  const { repaired } = sweep;
  logger[sweep.outcome === 'swept' ? 'info' : 'warn']('github sweep repaired', {
    outcome: sweep.outcome,
    repository: sweep.repo,
    capped: sweep.capped,
    failure: sweep.failure,
    swept_through: sweep.sweptThrough?.toISOString() ?? null,
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

async function sweepRepository(run: Run, repo: RepoRecord): Promise<RepositorySweep> {
  const pass: Pass = {
    run,
    repo,
    reads: createGitHubReads(run.deps.app, run.transport),
    swept: new Set(),
    repaired: noRepairs,
    capped: false,
    heldAt: null,
  };
  if (remaining(run.budget) < repositoryStart + perPullRequest) {
    return logged(run.logger, { ...finished(pass, 'deferred', null, null), capped: true });
  }
  try {
    return logged(run.logger, await passOver(pass));
  } catch (error) {
    run.logger.error('github sweep failed for a repository', {
      outcome: 'internal_error',
      repository: repo.fullName,
      ...errorFields(error),
    });
    return finished(pass, 'failed', null, null);
  }
}

export async function sweepGitHub(
  deps: SweepDeps,
  logger: Logger,
  options: SweepOptions = {},
): Promise<SweepReport> {
  const budget: Budget = { spent: 0, limit: options.maxSubrequests ?? defaultSubrequests };
  const transport = metered(deps.transport, budget);
  const startedAt = deps.now();
  const run: Run = {
    deps,
    logger,
    budget,
    transport,
    startedAt,
    maxPages: options.maxPages ?? defaultPages,
  };
  const listed = await createGitHubReads(deps.app, transport).installationRepositories();
  if (!listed.ok) {
    const { failure, status } = listed;
    logger.warn('github repositories not listed', {
      outcome: 'repositories_not_listed',
      failure,
      status,
    });
    return { repositories: [], failure, subrequests: budget.spent };
  }
  const repositories: RepositorySweep[] = [];
  for (const repo of listed.value.map(repoFromRest)) {
    if (repo !== null) repositories.push(await sweepRepository(run, repo));
  }
  return { repositories, failure: null, subrequests: budget.spent };
}
