import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { pullRequestFacts } from './facts/queries.ts';
import restIssues from './fixtures/rest-issues.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import { changedPaths, head } from './testing/facts-fixtures.ts';
import {
  firstRun,
  issuesOf,
  nextRun,
  other,
  outage,
  platform,
  programmed,
  requestsTo,
  reviewsPath,
  storedRepository,
  sweepOnce,
  tokenPath,
  withOtherRepository,
  zero,
} from './testing/sweep-rig.ts';

const platformId = 9100000001;
const otherId = 9100000002;
const overlap = 10 * 60_000;
const firstRepairs = {
  repos: 1,
  milestones: 1,
  issues: 1,
  pullRequests: 1,
  checkRuns: 1,
  reviews: 1,
  files: 1,
};
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

async function firstSweep(db: Database): Promise<void> {
  const github = programmed();
  const { report } = await sweepOnce(db, app, { github, at: firstRun });
  const listings = requestsTo(github, issuesOf(platform));
  expect(listings.map((request) => new URLSearchParams(request.search).has('since'))).toEqual([
    false,
  ]);
  expect(report.repositories).toEqual([
    {
      repo: platform,
      outcome: 'swept',
      repaired: firstRepairs,
      sweptThrough: firstRun,
      capped: false,
      failure: null,
    },
  ]);
  expect(await storedRepository(db, platformId)).toEqual({
    sweptThrough: firstRun,
    lastSweep: { at: firstRun.toISOString(), repaired: firstRepairs },
  });
  expect(await pullRequestFacts(db, { repo: platform, number: 7 })).toMatchObject({
    head,
    state: 'open',
    files: { head, paths: changedPaths },
    checks: [expect.objectContaining({ name: 'test', conclusion: 'success' })],
    reviews: [expect.objectContaining({ reviewer: 'uw-reviewer[bot]', state: 'approved' })],
  });
}

async function secondSweep(db: Database): Promise<void> {
  await sweepOnce(db, app, { github: programmed(), at: firstRun });
  const github = programmed();
  const { report } = await sweepOnce(db, app, { github, at: nextRun });
  const since = new Date(firstRun.getTime() - overlap).toISOString();
  const [listing] = requestsTo(github, issuesOf(platform));
  expect(new URLSearchParams(listing?.search).get('since')).toBe(since);
  expect(report.repositories).toEqual([
    expect.objectContaining({ outcome: 'swept', repaired: zero, sweptThrough: nextRun }),
  ]);
  expect(await storedRepository(db, platformId)).toEqual({
    sweptThrough: nextRun,
    lastSweep: { at: nextRun.toISOString(), repaired: zero },
  });
  expect(github.requests().some((request) => request.path.includes('/compare/'))).toBe(false);
}

async function missedReview(db: Database): Promise<void> {
  const first = programmed();
  first.on('GET', reviewsPath(7), { status: 200, body: [] });
  await sweepOnce(db, app, { github: first, at: firstRun });
  const github = programmed();
  github.on('GET', issuesOf(platform), { status: 200, body: [] });
  const { report } = await sweepOnce(db, app, { github, at: nextRun });
  expect(report.repositories[0]?.repaired).toEqual({ ...zero, reviews: 1 });
  expect((await pullRequestFacts(db, { repo: platform, number: 7 }))?.reviews).toEqual([
    expect.objectContaining({ reviewId: 9100000301, state: 'approved', commit: head }),
  ]);
}

describe.skipIf(!testServer)(
  'GH-2 the nightly sweep repairs what the webhooks missed, from a watermark, through the same upsert',
  () => {
    it('lists every issue on an empty read model and records what it repaired', () =>
      withAppDatabase(firstSweep));

    it('lists from the watermark less ten minutes and repairs nothing new', () =>
      withAppDatabase(secondSweep));

    it('re-reads every open pull request, so a review the webhooks missed is repaired', () =>
      withAppDatabase(missedReview));
  },
);

function fullPage() {
  return Array.from({ length: 100 }, (_, index) => ({
    ...restIssues[0],
    id: 9100001000 + index,
    number: 100 + index,
    milestone: null,
    updated_at: new Date(Date.UTC(2026, 9, 2, 0, index)).toISOString().replace('.000', ''),
  }));
}

async function cappedListing(db: Database): Promise<void> {
  const github = programmed();
  const page = fullPage();
  github.on('GET', issuesOf(platform), { status: 200, body: page });
  const { report } = await sweepOnce(db, app, { github, at: firstRun, options: { maxPages: 1 } });
  const last = new Date(page[99]?.updated_at ?? '');
  expect(report.repositories).toEqual([
    expect.objectContaining({ outcome: 'swept', capped: true, sweptThrough: last }),
  ]);
  expect(report.repositories[0]?.repaired.issues).toBe(100);
  expect(requestsTo(github, issuesOf(platform))).toHaveLength(1);
  expect((await storedRepository(db, platformId))?.sweptThrough).toEqual(last);
}

async function listingFails(db: Database): Promise<void> {
  await sweepOnce(db, app, { github: programmed(), at: firstRun });
  const github = programmed();
  withOtherRepository(github);
  github.on('GET', issuesOf(platform), outage);
  const { report, lines } = await sweepOnce(db, app, { github, at: nextRun });
  expect(report.repositories).toEqual([
    expect.objectContaining({
      repo: platform,
      outcome: 'failed',
      failure: 'server_error',
      sweptThrough: null,
    }),
    expect.objectContaining({ repo: other, outcome: 'swept', sweptThrough: nextRun }),
  ]);
  expect((await storedRepository(db, platformId))?.sweptThrough).toEqual(firstRun);
  expect((await storedRepository(db, otherId))?.sweptThrough).toEqual(nextRun);
  expect(lines).toContainEqual(
    expect.objectContaining({ message: 'github sweep repaired', outcome: 'failed' }),
  );
}

describe.skipIf(!testServer)('GH-2 the sweep moves the watermark only past what it stored', () => {
  it('stops at the last listed issue when the page limit caps the listing', () =>
    withAppDatabase(cappedListing));

  it('keeps the watermark when the listing fails and still sweeps the next repository', () =>
    withAppDatabase(listingFails));
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

describe.skipIf(!testServer)('GH-2 the sweep mints one token per repository per run', () => {
  it('mints one token to list the repositories and one for each repository', () =>
    withAppDatabase(tokensPerRepository));
});
