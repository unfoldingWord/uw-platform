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
  listedAt,
  listedPull,
  nextRun,
  other,
  outage,
  platform,
  programmed,
  pullNumbered,
  pullPath,
  reviewsPath,
  storedRepository,
  sweepOnce,
  withOtherRepository,
} from './testing/sweep-rig.ts';

const platformId = 9100000001;
const otherId = 9100000002;
const laterPull = '2026-10-02T09:00:00Z';
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function withLaterPull() {
  const github = programmed();
  github.on('GET', issuesOf(platform), {
    status: 200,
    body: [...restIssues, listedPull(8, laterPull)],
  });
  github.on('GET', pullPath(8), { status: 200, body: pullNumbered(8, laterPull) });
  github.on('GET', reviewsPath(8), { status: 200, body: [] });
  return github;
}

async function stalled(db: Database): Promise<void> {
  await sweepOnce(db, app, { github: withLaterPull(), at: firstRun });
  const github = withLaterPull();
  github.on('GET', reviewsPath(7), outage);
  const { report, lines } = await sweepOnce(db, app, { github, at: nextRun });
  expect(report.repositories).toEqual([
    expect.objectContaining({
      outcome: 'stalled',
      heldAt: listedAt,
      candidate: listedAt,
      sweptThrough: new Date(laterPull),
    }),
  ]);
  expect(await storedRepository(db, platformId)).toEqual({
    sweptThrough: new Date(laterPull),
    lastSweep: expect.objectContaining({
      outcome: 'stalled',
      heldAt: listedAt.toISOString(),
      reason: 'pull_request_not_swept',
      at: nextRun.toISOString(),
    }) as unknown,
  });
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'stalled' }));
}

async function slowRunFinishesLate(db: Database): Promise<void> {
  await sweepOnce(db, app, { github: withLaterPull(), at: nextRun });
  const { report } = await sweepOnce(db, app, { github: programmed(), at: firstRun });
  expect(report.repositories[0]).toMatchObject({
    candidate: listedAt,
    sweptThrough: new Date(laterPull),
  });
  expect(await storedRepository(db, platformId)).toMatchObject({
    sweptThrough: new Date(laterPull),
    lastSweep: expect.objectContaining({ at: firstRun.toISOString() }) as unknown,
  });
}

async function overlappingRuns(db: Database): Promise<void> {
  const runs = await Promise.all([
    sweepOnce(db, app, { github: programmed(), at: firstRun }),
    sweepOnce(db, app, { github: programmed(), at: firstRun }),
  ]);
  const repaired = runs.map((run) => run.report.repositories[0]?.repaired.pullRequests ?? 0);
  expect(repaired.reduce((sum, count) => sum + count, 0)).toBe(1);
  expect((await storedRepository(db, platformId))?.sweptThrough).toEqual(listedAt);
  expect((await pullRequestFacts(db, { repo: platform, number: 7 }))?.reviews).toHaveLength(1);
}

describe.skipIf(!testServer)('GH-2 the sweep records every run and never moves back', () => {
  it('records a hold below the watermark as a stall and keeps the watermark', () =>
    withAppDatabase(stalled));

  it('keeps the newer watermark and still records an older run that finishes after it', () =>
    withAppDatabase(slowRunFinishesLate));

  it('writes each fact once when two runs overlap', () => withAppDatabase(overlappingRuns));
});

function busyNight() {
  const github = programmed();
  withOtherRepository(github);
  const quietIssue = { ...restIssues[0], id: 9100000150, number: 3, milestone: null };
  github.on('GET', issuesOf(other), {
    status: 200,
    body: [{ ...quietIssue, updated_at: '2026-10-02T12:00:00Z' }],
  });
  return github;
}

function outcomes(sweeping: Awaited<ReturnType<typeof sweepOnce>>) {
  return sweeping.report.repositories.map((sweep) => [sweep.repo, sweep.outcome]);
}

async function busyFirst(db: Database): Promise<void> {
  const options = { maxSubrequests: 16 };
  await sweepOnce(db, app, { github: busyNight(), at: new Date('2026-10-02T03:17:00Z') });
  const first = await sweepOnce(db, app, { github: busyNight(), at: firstRun, options });
  expect(outcomes(first)).toEqual([
    [platform, 'ok'],
    [other, 'deferred'],
  ]);
  expect((await storedRepository(db, otherId))?.lastSweep).toMatchObject({ outcome: 'deferred' });
  const second = await sweepOnce(db, app, { github: busyNight(), at: nextRun, options });
  expect(outcomes(second)).toEqual([
    [other, 'ok'],
    [platform, 'ok'],
  ]);
}

function throwingAt(call: number, at: Date) {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === call) throw new Error('clock unavailable');
    return at;
  };
}

async function throwingFirst(db: Database): Promise<void> {
  const options = { maxSubrequests: 16 };
  const night = () => {
    const github = programmed();
    withOtherRepository(github);
    return github;
  };
  const now = throwingAt(5, firstRun);
  const first = await sweepOnce(db, app, { github: night(), at: firstRun, options, now });
  expect(outcomes(first)).toEqual([
    [platform, 'failed'],
    [other, 'deferred'],
  ]);
  expect((await storedRepository(db, platformId))?.lastSweep).toMatchObject({
    outcome: 'failed',
    reason: 'internal_error',
    attemptedAt: firstRun.toISOString(),
  });
  const second = await sweepOnce(db, app, { github: night(), at: nextRun, options });
  expect(outcomes(second)[0]).toEqual([other, 'ok']);
}

async function unparsedCounted(db: Database): Promise<void> {
  const github = programmed();
  const broken = { id: 9100000777, number: 77, updated_at: '2026-10-02T07:00:00Z' };
  github.on('GET', issuesOf(platform), {
    status: 200,
    body: [broken, { number: 78 }, ...restIssues],
  });
  const { report, lines } = await sweepOnce(db, app, { github, at: firstRun });
  expect(report.repositories[0]?.unparsedItems).toBe(2);
  expect(lines).toContainEqual(
    expect.objectContaining({ message: 'github sweep repaired', unparsed_items: 2 }),
  );
}

describe.skipIf(!testServer)('the sweep reaches every repository and shows what it skipped', () => {
  it('starts the repository it deferred first on the next run, so none starves', () =>
    withAppDatabase(busyFirst));

  it('records a repository that throws, so it does not run first every night', () =>
    withAppDatabase(throwingFirst));

  it('counts the listed items it could not read', () => withAppDatabase(unparsedCounted));
});
