import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import type { GitHubDeps } from './deps.ts';
import issuesLabeled from './fixtures/issues-labeled.json' with { type: 'json' };
import issuesUnlabeled from './fixtures/issues-unlabeled.json' with { type: 'json' };
import { fixtureApp } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';
import {
  deliver,
  depsOn,
  imported,
  platform,
  posts,
  seedSoftwareHarness,
  withComments,
} from './testing/import-rig.ts';
import { programmed, sweepOnce } from './testing/sweep-rig.ts';

const firstSweep = new Date('2026-10-03T03:17:00.000Z');
let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

const closedLabelled = {
  ...issuesLabeled,
  action: 'closed',
  issue: { ...issuesLabeled.issue, state: 'closed', updated_at: '2026-10-02T08:30:00Z' },
};

function oldClosed(number: number) {
  return {
    id: 9100000150 + number,
    number,
    title: `Old issue ${number}`,
    state: 'closed',
    labels: [{ name: 'harness' }],
    milestone: null,
    updated_at: `2025-0${number}-01T00:00:00Z`,
  };
}

async function counts(db: Database) {
  const [row] = await db.$client`
    SELECT (SELECT count(*)::int FROM pages WHERE type = 'issue') AS pages,
           (SELECT count(*)::int FROM harness_items) AS items,
           (SELECT count(*)::int FROM harness_events WHERE name = 'label_removed') AS removals`;
  return row;
}

function commentCalls(github: FixtureGitHub) {
  return github.requests().filter((request) => request.path.endsWith('/comments'));
}

async function closedCreatesNothing(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub());
  const lines = await deliver(depsOn(db, app, github), closedLabelled);
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'issue_closed' }));
  expect(await counts(db)).toEqual({ pages: 0, items: 0, removals: 0 });
  expect(github.requests()).toEqual([]);
}

async function closedAfterImport(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub());
  const deps = depsOn(db, app, github);
  await deliver(deps, issuesLabeled);
  await deliver(deps, closedLabelled);
  expect(await counts(db)).toEqual({ pages: 1, items: 1, removals: 0 });
  expect(posts(github)).toHaveLength(1);
  expect(await imported(db)).toMatchObject({
    items: [expect.objectContaining({ stage: 'package' })],
  });
}

async function firstSweepOverOldIssues(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = programmed();
  github.on('GET', `/repos/${platform}/issues`, {
    status: 200,
    body: [oldClosed(1), oldClosed(2), oldClosed(3)],
  });
  await sweepOnce(db, app, { github, at: firstSweep });
  expect(await counts(db)).toEqual({ pages: 0, items: 0, removals: 0 });
  expect(commentCalls(github)).toEqual([]);
}

describe.skipIf(!testServer)('only an open labelled issue is imported (S5-R46)', () => {
  it('creates nothing and calls GitHub for nothing for a closed labelled issue', () =>
    withAppDatabase(closedCreatesNothing));

  it('keeps the item of an issue closed after its import, with its one comment', () =>
    withAppDatabase(closedAfterImport));

  it("imports none of a repository's old closed labelled issues on its first sweep", () =>
    withAppDatabase(firstSweepOverOldIssues));
});

function counted(deps: GitHubDeps): { readonly deps: GitHubDeps; readonly calls: () => number } {
  let calls = 0;
  const { items } = deps.kernel;
  const labelRemoved: typeof items.labelRemoved = (caller, input) => {
    calls += 1;
    return items.labelRemoved(caller, input);
  };
  const kernel = { ...deps.kernel, items: { ...items, labelRemoved } };
  return { deps: { ...deps, kernel }, calls: () => calls };
}

const neverLabelled = {
  ...issuesUnlabeled,
  issue: { ...issuesUnlabeled.issue, id: 9100000140, number: 40 },
};

async function removalOnlyWithItem(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const { deps, calls } = counted(depsOn(db, app, withComments(fixtureGitHub())));
  await deliver(deps, neverLabelled);
  expect(calls()).toBe(0);
  await deliver(deps, issuesLabeled);
  await deliver(deps, issuesUnlabeled);
  expect(calls()).toBe(1);
  expect(await counts(db)).toMatchObject({ items: 1, removals: 1 });
}

describe.skipIf(!testServer)(
  'a removed label is recorded only for an issue that has an item (S5-R46)',
  () => {
    it('makes no labelRemoved call for an unlabelled issue with no item', () =>
      withAppDatabase(removalOnlyWithItem));
  },
);
