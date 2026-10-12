import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@uw/db/client';
import { seedPage } from '@uw/db/test-seed';
import { testServer, withAppDatabase } from '../testing/postgres.ts';
import type { GitHubAppConfig } from './app-config.ts';
import { createGitHubReads } from './client.ts';
import { createIssueComments } from './comments.ts';
import type { GitHubDeps } from './deps.ts';
import issuesLabeled from './fixtures/issues-labeled.json' with { type: 'json' };
import { fixtureApp, fixtureTransport } from './testing/app-key.ts';
import { fixtureGitHub, type FixtureGitHub } from './testing/fixture-github.ts';
import {
  commentId,
  commentsPath,
  deliver,
  depsOn,
  imported,
  issueId,
  platform,
  posts,
  seedSoftwareHarness,
  withComments,
} from './testing/import-rig.ts';

let app: GitHubAppConfig;

beforeAll(async () => {
  app = await fixtureApp();
});

function hangingPosts(github: FixtureGitHub): typeof fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const hangs = init?.method === 'POST' && url.pathname === commentsPath;
    if (!hangs) return github.fetch(input, init);
    void github.fetch(input, init);
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
  };
}

function hangingDeps(db: Database, github: FixtureGitHub): GitHubDeps {
  const transport = { ...fixtureTransport(github), fetch: hangingPosts(github) };
  return {
    ...depsOn(db, app, github),
    client: {
      appId: app.appId,
      reads: () => createGitHubReads(app, transport),
      comments: () => createIssueComments(app, transport, 50),
    },
  };
}

async function claimOf(db: Database) {
  const [row] = await db.$client`
    SELECT xref_claimed_at IS NULL AS released FROM gh_issues WHERE github_id = ${issueId}`;
  return row;
}

async function timedOut(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub());
  const lines = await deliver(hangingDeps(db, github), issuesLabeled);
  expect(lines).toContainEqual(
    expect.objectContaining({ outcome: 'cross_reference_not_posted', failure: 'unreachable' }),
  );
  expect(await claimOf(db)).toEqual({ released: true });
  expect(await imported(db)).toMatchObject({ commentId: null });
  await deliver(depsOn(db, app, github), issuesLabeled);
  expect(posts(github)).toHaveLength(2);
  expect(await imported(db)).toMatchObject({ commentId });
}

async function listsSincePage(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub());
  await deliver(depsOn(db, app, github), issuesLabeled);
  const [page] = await db.$client`SELECT created_at FROM pages WHERE type = 'issue'`;
  const created = new Date(String(page?.['created_at']));
  const [listing] = github
    .requests()
    .filter((request) => request.method === 'GET' && request.path === commentsPath);
  const since = new URLSearchParams(listing?.search).get('since');
  expect(since).toBe(new Date(created.getTime() - 60 * 60_000).toISOString());
}

async function raced(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  const github = withComments(fixtureGitHub());
  const deps = () => depsOn(db, app, github);
  await Promise.all([
    deliver(deps(), issuesLabeled),
    deliver(deps(), issuesLabeled),
    deliver(deps(), issuesLabeled),
  ]);
  expect(posts(github)).toHaveLength(1);
  const stored = await imported(db);
  expect(stored).toMatchObject({ commentId });
  expect(stored.items).toHaveLength(1);
  expect(stored.pages).toHaveLength(1);
}

async function personPlaced(db: Database): Promise<void> {
  await seedSoftwareHarness(db);
  await seedPage(db, {
    id: '00000000-0000-4000-8000-000000001797',
    type: 'issue',
    status: 'active',
    jdArea: '80-89',
    slug: `issue-${issueId}`,
    title: 'Planted',
    bodyMd: 'Read this instead.',
    frontmatter: {
      repo: platform,
      number: 12,
      github_id: issueId,
      url: `https://github.com/${platform}/issues/12`,
    },
  });
  const github = withComments(fixtureGitHub());
  const lines = await deliver(depsOn(db, app, github), issuesLabeled);
  expect(lines).toContainEqual(expect.objectContaining({ outcome: 'issue_page_slug_taken' }));
  expect((await imported(db)).items).toEqual([]);
  expect(github.requests()).toEqual([]);
}

describe.skipIf(!testServer)(
  'GH-3 exactly one cross-reference comment lands, however the post goes',
  () => {
    it('releases the claim when the post outlasts its timeout, and the next attempt posts', () =>
      withAppDatabase(timedOut));

    it('lists comments only since the issue page was written', () =>
      withAppDatabase(listsSincePage));

    it('posts once when three first deliveries race', () => withAppDatabase(raced));
  },
);

describe.skipIf(!testServer)('the import wraps only a page the import wrote (S5-R47)', () => {
  it('answers slug_taken and creates no item for a pre-placed page with this github_id', () =>
    withAppDatabase(personPlaced));
});
