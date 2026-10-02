import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { pullRequestFacts } from './facts/queries.ts';
import restIssues from './fixtures/rest-issues.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import {
  firstRun,
  issuesOf,
  listedPull,
  nextRun,
  outage,
  platform,
  programmed,
  pullNumbered,
  pullPath,
  reviewsPath,
  storedRepository,
  sweepOnce,
} from './testing/sweep-rig.ts';

const platformId = 9100000001;
const laterPull = '2026-10-02T09:00:00Z';
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function withTwoPulls() {
  const github = programmed();
  github.on('GET', issuesOf(platform), {
    status: 200,
    body: [...restIssues, listedPull(8, laterPull)],
  });
  github.on('GET', pullPath(8), { status: 200, body: pullNumbered(8, laterPull) });
  github.on('GET', reviewsPath(8), { status: 200, body: [] });
  return github;
}

async function pullFails(db: Database): Promise<void> {
  const github = withTwoPulls();
  github.on('GET', reviewsPath(7), outage);
  const { report, lines } = await sweepOnce(db, app, { github, at: firstRun });
  expect(report.repositories).toEqual([
    expect.objectContaining({
      outcome: 'swept',
      sweptThrough: new Date('2026-10-02T08:00:00Z'),
    }),
  ]);
  expect(lines).toContainEqual(
    expect.objectContaining({
      outcome: 'pull_request_not_swept',
      pull_request: 7,
      failure: 'server_error',
    }),
  );
  expect(await pullRequestFacts(db, { repo: platform, number: 7 })).toBeNull();
  expect(await pullRequestFacts(db, { repo: platform, number: 8 })).not.toBeNull();
  expect((await storedRepository(db, platformId))?.sweptThrough).toEqual(
    new Date('2026-10-02T08:00:00Z'),
  );
}

describe.skipIf(!testServer)(
  'GH-2 a pull request the sweep cannot read holds the watermark at it',
  () => {
    it('sweeps the others and keeps the watermark at the unread pull request', () =>
      withAppDatabase(pullFails));
  },
);

async function budgetStops(db: Database): Promise<void> {
  const github = withTwoPulls();
  const { report } = await sweepOnce(db, app, {
    github,
    at: firstRun,
    options: { maxSubrequests: 12 },
  });
  expect(github.requests().length).toBeLessThanOrEqual(12);
  expect(report.repositories).toEqual([
    expect.objectContaining({
      outcome: 'swept',
      capped: true,
      sweptThrough: new Date(laterPull),
    }),
  ]);
  expect(await pullRequestFacts(db, { repo: platform, number: 7 })).not.toBeNull();
  expect(await pullRequestFacts(db, { repo: platform, number: 8 })).toBeNull();
}

async function budgetDefers(db: Database): Promise<void> {
  const github = programmed();
  const { report } = await sweepOnce(db, app, {
    github,
    at: firstRun,
    options: { maxSubrequests: 11 },
  });
  expect(github.requests()).toHaveLength(2);
  expect(report.repositories).toEqual([
    expect.objectContaining({ repo: platform, outcome: 'deferred', sweptThrough: null }),
  ]);
  expect(await storedRepository(db, platformId)).toBeNull();
}

async function neverOverBudget(db: Database): Promise<void> {
  for (const limit of [1, 2, 5, 9, 10, 13, 20]) {
    const github = withTwoPulls();
    await sweepOnce(db, app, { github, at: firstRun, options: { maxSubrequests: limit } });
    expect(github.requests().length).toBeLessThanOrEqual(limit);
  }
}

describe.skipIf(!testServer)('GH-2 the sweep stays inside its subrequest bound', () => {
  it('stops before a pull request it cannot afford and holds the watermark there', () =>
    withAppDatabase(budgetStops));

  it('defers a repository it cannot afford to start', () => withAppDatabase(budgetDefers));

  it('never sends more requests than the bound', () => withAppDatabase(neverOverBudget));
});

async function slowRunFinishesLate(db: Database): Promise<void> {
  await sweepOnce(db, app, { github: programmed(), at: nextRun });
  await sweepOnce(db, app, { github: programmed(), at: firstRun });
  expect((await storedRepository(db, platformId))?.sweptThrough).toEqual(nextRun);
}

async function overlappingRuns(db: Database): Promise<void> {
  const runs = await Promise.all([
    sweepOnce(db, app, { github: programmed(), at: firstRun }),
    sweepOnce(db, app, { github: programmed(), at: firstRun }),
  ]);
  const repaired = runs.map((run) => run.report.repositories[0]?.repaired.pullRequests ?? 0);
  expect(repaired.reduce((sum, count) => sum + count, 0)).toBe(1);
  expect((await storedRepository(db, platformId))?.sweptThrough).toEqual(firstRun);
  expect((await pullRequestFacts(db, { repo: platform, number: 7 }))?.reviews).toHaveLength(1);
}

describe.skipIf(!testServer)('GH-2 overlapping sweeps neither regress nor double-write', () => {
  it('keeps the newer watermark when an older run finishes after it', () =>
    withAppDatabase(slowRunFinishesLate));

  it('writes each fact once when two runs overlap', () => withAppDatabase(overlappingRuns));
});
