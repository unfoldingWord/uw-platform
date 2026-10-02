import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { pullRequestFacts } from './facts/queries.ts';
import restIssues from './fixtures/rest-issues.json' with { type: 'json' };
import restReviews from './fixtures/rest-reviews.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import {
  firstRun,
  issuesOf,
  listedAt,
  listedPull,
  outage,
  platform,
  programmed,
  pullNumbered,
  pullPath,
  requestsTo,
  reviewsPath,
  storedRepository,
  sweepOnce,
  tokenPath,
  withOtherRepository,
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
      outcome: 'ok',
      reason: 'pull_request_not_swept',
      heldAt: listedAt,
      sweptThrough: listedAt,
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
  expect((await storedRepository(db, platformId))?.sweptThrough).toEqual(listedAt);
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
  const options = { maxSubrequests: 12 };
  const { report } = await sweepOnce(db, app, { github, at: firstRun, options });
  expect(github.requests().length).toBeLessThanOrEqual(12);
  expect(report.repositories).toEqual([
    expect.objectContaining({
      outcome: 'capped',
      reason: 'budget_exhausted',
      sweptThrough: new Date(laterPull),
    }),
  ]);
  expect(await pullRequestFacts(db, { repo: platform, number: 7 })).not.toBeNull();
  expect(await pullRequestFacts(db, { repo: platform, number: 8 })).toBeNull();
}

async function budgetInsidePull(db: Database): Promise<void> {
  const github = programmed();
  const fullPage = Array.from({ length: 100 }, () => restReviews[0]);
  github.on('GET', reviewsPath(7), { status: 200, body: fullPage });
  const options = { maxSubrequests: 12 };
  const { report, lines } = await sweepOnce(db, app, { github, at: firstRun, options });
  expect(github.requests()).toHaveLength(12);
  expect(report.repositories).toEqual([
    expect.objectContaining({ outcome: 'capped', reason: 'budget_exhausted', heldAt: listedAt }),
  ]);
  expect(lines).toContainEqual(
    expect.objectContaining({ outcome: 'pull_request_not_swept', failure: 'budget_exhausted' }),
  );
}

async function budgetDefers(db: Database): Promise<void> {
  const github = programmed();
  const options = { maxSubrequests: 11 };
  const { report } = await sweepOnce(db, app, { github, at: firstRun, options });
  expect(github.requests()).toHaveLength(2);
  expect(report.repositories).toEqual([
    expect.objectContaining({ repo: platform, outcome: 'deferred', reason: 'budget_exhausted' }),
  ]);
  expect(await storedRepository(db, platformId)).toEqual({
    sweptThrough: null,
    lastSweep: expect.objectContaining({
      outcome: 'deferred',
      reason: 'budget_exhausted',
      attemptedAt: null,
    }) as unknown,
  });
}

async function neverOverBudget(db: Database): Promise<void> {
  for (const limit of [1, 2, 5, 9, 10, 13, 20]) {
    const github = withTwoPulls();
    await sweepOnce(db, app, { github, at: firstRun, options: { maxSubrequests: limit } });
    expect(github.requests().length).toBeLessThanOrEqual(limit);
  }
}

describe.skipIf(!testServer)('the sweep stays inside its subrequest bound', () => {
  it('stops before a pull request it cannot afford and holds the watermark there', () =>
    withAppDatabase(budgetStops));

  it('names running out of budget inside a pull request as budget_exhausted', () =>
    withAppDatabase(budgetInsidePull));

  it('defers and records a repository it cannot afford to start', () =>
    withAppDatabase(budgetDefers));

  it('never sends more requests than the bound', () => withAppDatabase(neverOverBudget));
});

async function tokensPerRepository(db: Database): Promise<void> {
  const github = programmed();
  withOtherRepository(github);
  await sweepOnce(db, app, { github, at: firstRun });
  const scopes = requestsTo(github, tokenPath).map((request) => request.body);
  expect(scopes).toEqual([
    { permissions: { metadata: 'read' } },
    expect.objectContaining({ repositories: ['uw-platform'] }),
    expect.objectContaining({ repositories: ['uw-other'] }),
  ]);
}

describe.skipIf(!testServer)('the sweep mints one token per repository per run', () => {
  it('mints one token to list the repositories and one for each repository', () =>
    withAppDatabase(tokensPerRepository));
});
