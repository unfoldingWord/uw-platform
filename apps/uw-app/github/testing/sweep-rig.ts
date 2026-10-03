import { eq } from 'drizzle-orm';
import type { Database } from '@uw/db/client';
import type { Hub } from '@uw/harness';
import { cronLogger } from '../../cron/job.ts';
import { ghRepos } from '@uw/db/schema';
import { systemClock } from '../../ports/clock.ts';
import { kernelOn } from '../../testing/kernel.ts';
import type { GitHubAppConfig } from '../app-config.ts';
import restCheckRuns from '../fixtures/rest-check-runs.json' with { type: 'json' };
import restFiles from '../fixtures/rest-files.json' with { type: 'json' };
import restRepositories from '../fixtures/rest-installation-repositories.json' with { type: 'json' };
import restIssues from '../fixtures/rest-issues.json' with { type: 'json' };
import restPull from '../fixtures/rest-pull.json' with { type: 'json' };
import restReviews from '../fixtures/rest-reviews.json' with { type: 'json' };
import { sweepGitHub, type SweepOptions, type SweepReport } from '../sweep.ts';
import { fixtureTransport } from './app-key.ts';
import { base, head } from './facts-fixtures.ts';
import { fixtureGitHub, type FixtureGitHub } from './fixture-github.ts';

type Line = Record<string, unknown>;

export const platform = 'unfoldingWord/uw-platform';
export const other = 'unfoldingWord/uw-other';
export const issuesOf = (repo: string) => `/repos/${repo}/issues`;
export const pullPath = (number: number) => `/repos/${platform}/pulls/${number}`;
export const reviewsPath = (number: number) => `${pullPath(number)}/reviews`;
const checkRunsPath = `/repos/${platform}/commits/${head}/check-runs`;
const comparePath = `/repos/${platform}/compare/${base}...${head}`;
export const tokenPath = '/app/installations/77/access_tokens';
export const outage = { status: 500, body: { message: 'Server Error' } };
export const listedAt = new Date('2026-10-02T08:00:00.000Z');
export const firstRun = new Date('2026-10-03T03:17:00.000Z');
export const nextRun = new Date('2026-10-04T03:17:00.000Z');
export const zero = {
  repos: 0,
  milestones: 0,
  issues: 0,
  pullRequests: 0,
  checkRuns: 0,
  reviews: 0,
  files: 0,
};

const [platformRepository] = restRepositories.repositories;
const otherRepository = {
  ...platformRepository,
  id: 9100000002,
  name: 'uw-other',
  full_name: other,
};

export function listedPull(number: number, updatedAt: string) {
  return {
    id: 9100000100 + number,
    number,
    title: `Pull ${number}`,
    state: 'open',
    labels: [],
    milestone: null,
    updated_at: updatedAt,
    pull_request: { url: `https://api.github.com/repos/${platform}/pulls/${number}` },
  };
}

export function pullNumbered(number: number, updatedAt: string) {
  return { ...restPull, id: 9100000200 + number, number, updated_at: updatedAt };
}

export function withOtherRepository(github: FixtureGitHub): void {
  github.on('GET', '/installation/repositories', {
    status: 200,
    body: { total_count: 2, repositories: [platformRepository, otherRepository] },
  });
  github.on('GET', issuesOf(other), { status: 200, body: [] });
}

export function programmed(): FixtureGitHub {
  const github = fixtureGitHub();
  github.on('GET', '/installation/repositories', { status: 200, body: restRepositories });
  github.on('GET', issuesOf(platform), { status: 200, body: restIssues });
  github.on('GET', pullPath(7), { status: 200, body: restPull });
  github.on('GET', reviewsPath(7), { status: 200, body: restReviews });
  github.on('GET', checkRunsPath, { status: 200, body: restCheckRuns });
  github.on('GET', comparePath, { status: 200, body: restFiles });
  return github;
}

export type Sweeping = {
  readonly report: SweepReport;
  readonly lines: readonly Line[];
};

export async function sweepOnce(
  db: Database,
  app: GitHubAppConfig,
  run: {
    readonly github: FixtureGitHub;
    readonly at: Date;
    readonly options?: SweepOptions;
    readonly now?: () => Date;
    readonly hub?: Hub;
  },
): Promise<Sweeping> {
  const lines: Line[] = [];
  const logger = cronLogger(
    {
      now: () => run.at,
      fetch: run.github.fetch,
      sink: (line) => lines.push(JSON.parse(line) as Line),
      newId: () => crypto.randomUUID(),
      commit: 'c',
    },
    'cron github sweep',
  );
  const deps = {
    db,
    kernel: kernelOn(db, systemClock, run.hub ? { hub: run.hub } : {}),
    now: run.now ?? (() => run.at),
    app,
    transport: fixtureTransport(run.github),
  };
  const report = await sweepGitHub(deps, logger, run.options);
  return { report, lines };
}

export async function storedRepository(db: Database, githubId: number) {
  const [row] = await db
    .select({ sweptThrough: ghRepos.sweptThrough, lastSweep: ghRepos.lastSweep })
    .from(ghRepos)
    .where(eq(ghRepos.githubId, githubId));
  return row ?? null;
}

export function requestsTo(github: FixtureGitHub, path: string) {
  return github.requests().filter((request) => request.path === path);
}
