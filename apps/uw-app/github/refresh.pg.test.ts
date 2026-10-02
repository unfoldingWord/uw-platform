import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { pullRequestFacts } from './facts/queries.ts';
import { fixtureApp } from './testing/app-key.ts';
import { base, head } from './testing/facts-fixtures.ts';
import type { FixtureGitHub } from './testing/fixture-github.ts';
import {
  attemptShip,
  compare,
  decisionRows,
  instant,
  movedBase,
  newPaths,
  oldPaths,
  pullBasedOn,
  pullRequest,
  pulls,
  riskAtShip,
} from './testing/ship-rig.ts';

const checkRuns = `/repos/unfoldingWord/uw-platform/commits/${head}/check-runs`;
const outage = { status: 500, body: { message: 'Server Error' } };
const storedAt = new Date('2026-10-02T08:00:00.000Z');
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function requested(github: FixtureGitHub): readonly string[] {
  return github.requests().map((request) => request.path);
}

async function retargetNotYetDelivered(db: Database): Promise<void> {
  const { github, item } = await attemptShip(db, app);
  expect(requested(github)).toContain(compare(movedBase));
  expect(requested(github)).not.toContain(compare(base));
  expect(await riskAtShip(db, item)).toEqual([
    expect.objectContaining({ paths: newPaths, head, floorDomains: ['migration'] }),
  ]);
  expect(await pullRequestFacts(db, pullRequest)).toMatchObject({
    base: movedBase,
    files: { head, base: movedBase, paths: newPaths },
    freshAt: instant,
  });
}

describe.skipIf(!testServer)(
  'GH-5 Ship re-reads the pull request from GitHub before it derives the risk',
  () => {
    it('uses the new base when a retarget has not been delivered yet', () =>
      withAppDatabase(retargetNotYetDelivered));
  },
);

async function refusedStale(db: Database, shipped: Awaited<ReturnType<typeof attemptShip>>) {
  expect(shipped.outcome).toMatchObject({ status: 'error', reason: 'facts_stale' });
  expect(await decisionRows(db, shipped.item)).toBe(0);
  expect(await riskAtShip(db, shipped.item)).toEqual([]);
}

function failingRead(path: string) {
  return async (db: Database): Promise<void> => {
    const shipped = await attemptShip(db, app, (github) => github.on('GET', path, outage));
    await refusedStale(db, shipped);
    expect(await pullRequestFacts(db, pullRequest)).toMatchObject({
      base,
      files: { head, base, paths: oldPaths },
      freshAt: storedAt,
    });
    expect(requested(shipped.github).some((path) => path.includes('/compare/'))).toBe(false);
    expect(shipped.lines).toEqual([
      expect.objectContaining({
        level: 'warn',
        outcome: 'refresh_failed',
        failure: 'server_error',
        status: 500,
        pull_request: 7,
      }),
    ]);
  };
}

async function compareFails(db: Database): Promise<void> {
  const shipped = await attemptShip(db, app, (github) =>
    github.on('GET', compare(movedBase), outage),
  );
  await refusedStale(db, shipped);
  expect(await pullRequestFacts(db, pullRequest)).toMatchObject({ base: movedBase, files: null });
  expect(requested(shipped.github)).not.toContain(compare(base));
  expect(shipped.lines).toEqual([
    expect.objectContaining({
      outcome: 'files_not_fetched',
      failure: 'server_error',
      status: 500,
      step: 'files',
    }),
  ]);
}

describe.skipIf(!testServer)('GH-5 Ship refuses when GitHub cannot be read again', () => {
  it('writes nothing and refuses as stale when the reviews cannot be read', () =>
    withAppDatabase(failingRead(`${pulls}/reviews`)));

  it('writes nothing and refuses as stale when the check runs cannot be read', () =>
    withAppDatabase(failingRead(checkRuns)));

  it('never uses the old base files and refuses as stale when the comparison fails', () =>
    withAppDatabase(compareFails));
});

function answering(change: (pull: ReturnType<typeof pullBasedOn>) => unknown) {
  return async (db: Database): Promise<void> => {
    const shipped = await attemptShip(db, app, (github, itemId) => {
      const pull = pullBasedOn(itemId, movedBase, '2026-10-02T08:50:00Z');
      github.on('GET', pulls, { status: 200, body: change(pull) });
    });
    await refusedStale(db, shipped);
    expect(await pullRequestFacts(db, pullRequest)).toMatchObject({ base, freshAt: storedAt });
    expect(shipped.lines).toEqual([
      expect.objectContaining({ outcome: 'refresh_failed', failure: 'malformed_response' }),
    ]);
  };
}

async function gone(db: Database): Promise<void> {
  const shipped = await attemptShip(db, app, (github) =>
    github.on('GET', pulls, { status: 404, body: { message: 'Not Found' } }),
  );
  expect(shipped.outcome.status).toBe('error');
  expect(await decisionRows(db, shipped.item)).toBe(0);
  expect(await pullRequestFacts(db, pullRequest)).toMatchObject({ base, freshAt: storedAt });
}

describe.skipIf(!testServer)(
  'GH-5 Ship refuses when GitHub answers for another pull request or none',
  () => {
    it('refuses when the answer names another repository', () =>
      withAppDatabase(
        answering((pull) => ({
          ...pull,
          base: { ...pull.base, repo: { ...pull.base.repo, full_name: 'unfoldingWord/other' } },
        })),
      ));

    it('refuses when the answer names another number', () =>
      withAppDatabase(answering((pull) => ({ ...pull, number: 8 }))));

    it('refuses when GitHub no longer has the pull request', () => withAppDatabase(gone));
  },
);
